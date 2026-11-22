import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import Ajv from "ajv";

import { consumeApprovalDecision, listPendingApprovals, readApprovalDecision, submitApprovalDecision } from "../runtime/src/approvals/files.js";
import { proposeResourceShare, validateApprovedResourceShare, validateStyleImportChange } from "../runtime/src/approvals/resource-sharing.js";
import { openInstance } from "../runtime/src/instances/store.js";
import { openResourceRegistry } from "../runtime/src/resources/registry.js";
import { resolveResource } from "../runtime/src/resources/resolver.js";
import type { ResourceRecord, ResourceRef, StyleManifest } from "../runtime/src/resources/types.js";
import { startReviewUi } from "../runtime/src/ui/server.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const source: ResourceRef = { resourceId: "brand", scope: "style", companyId: "acme", styleId: "owner", version: "1.0.0", sha256: hash("brand") };
const resource: ResourceRecord = { ...source, kind: "asset", path: "resources/brand.txt", status: "approved", allowedPurposes: ["generate"], exportPolicy: { mode: "allow-listed", consumerStyleIds: ["consumer"] } };
const proposal = () => ({ request_id: "share-001", companyId: "acme", targetScope: "company" as const, source: { ...source }, consumerStyleIds: ["consumer"], purposes: ["generate" as const], ownerConsent: { companyId: "acme", styleId: "owner", consented: true as const }, licenseNotes: "Company-owned asset", rollbackNotes: "Remove export and import", proposed_by: "local-owner" });

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "resource-sharing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const company = join(root, "acme");
  const core = join(root, "core");
  await mkdir(join(company, "approvals/requests"), { recursive: true });
  await mkdir(join(company, "resources"));
  await mkdir(core);
  await writeFile(join(company, "instance.yaml"), JSON.stringify({ company_id: "acme", core_version: "0.1.0", assets: [] }));
  await writeFile(join(core, "core-catalog.json"), JSON.stringify({ catalogVersion: "1.0.0", resources: [] }));
  await writeFile(join(company, resource.path), "brand");
  const manifests: StyleManifest[] = [
    { companyId: "acme", styleId: "owner", status: "approved", ownedResources: [source], imports: [] },
    { companyId: "acme", styleId: "consumer", status: "approved", ownedResources: [], imports: [source] },
  ];
  let current = structuredClone(resource);
  const save = async () => {
    const records = [current];
    for (const manifest of manifests) {
      const path = `styles/${manifest.styleId}/manifest.json`;
      const bytes = JSON.stringify(manifest);
      await mkdir(dirname(join(company, path)), { recursive: true });
      await writeFile(join(company, path), bytes);
      records.push({ ...resource, resourceId: `${manifest.styleId}-manifest`, styleId: manifest.styleId, kind: "style-manifest", path, sha256: hash(bytes) });
    }
    await writeFile(join(company, "resources/catalog.json"), JSON.stringify({ catalogVersion: "1.0.0", resources: records }));
  };
  await save();
  const store = await openInstance(root, "acme");
  const registry = await openResourceRegistry(store, { coreResourcesRoot: core });
  const request = proposeResourceShare(registry, proposal());
  const requestPath = join(company, "approvals/requests/share-001.json");
  await writeFile(requestPath, JSON.stringify(request));
  const decision = async () => ({ companyId: "acme", request_id: "share-001", request_hash: (await listPendingApprovals(store))[0].request_hash, decision: { action: "approve" as const } });
  const approve = async () => submitApprovalDecision(store, await decision());
  return { root, company, core, store, registry, manifests, request, requestPath, save, decision, approve, setResource: (value: ResourceRecord) => { current = value; } };
}

test("company share uses canonical decisions without publishing or granting access by approval alone", async (t) => {
  const f = await fixture(t);
  const before = await readFile(join(f.company, "resources/catalog.json"), "utf8");
  await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /approved|decision/i);
  const decision = await f.approve();
  assert.equal(consumeApprovalDecision(f.store, f.request, decision).status, "approved");
  assert.equal((await validateApprovedResourceShare(f.registry, "share-001")).source.resourceId, "brand");
  assert.equal(await readFile(join(f.company, "resources/catalog.json"), "utf8"), before);
  assert.deepEqual(JSON.parse(await readFile(join(f.core, "core-catalog.json"), "utf8")).resources, []);
  await validateStyleImportChange(f.registry, f.manifests[1], ["share-001"]);
  f.setResource({ ...resource, exportPolicy: undefined });
  await f.save();
  await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /export|consumer/i);
  const refreshed = await openResourceRegistry(f.store, { coreResourcesRoot: f.core });
  await assert.rejects(resolveResource(refreshed, source, { companyId: "acme", styleId: "consumer", purpose: "generate" }), /export|import|denied/i);
});

test("resource proposals reject foreign companies, unregistered identities, missing owner consent and promotion", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { companyId: "foreign" }, { source: { ...source, companyId: "foreign" } },
    { source: { ...source, resourceId: "absent" } }, { source: { ...source, scope: "core", companyId: undefined, styleId: undefined } },
    { ownerConsent: undefined }, { ownerConsent: { companyId: "acme", styleId: "consumer", consented: true } },
    { targetScope: "core" }, { targetCompanyId: "foreign" }, { consumerStyleIds: ["absent"] },
    { type: "cross-company-promotion" }, { status: "approved" },
  ]) assert.throws(() => proposeResourceShare(f.registry, { ...proposal(), ...patch } as never), /company|share|registered|owner|consumer|consent/i);
  assert.throws(() => proposeResourceShare({ ...f.registry }, proposal()), /registry/i);
});

test("canonical local approval API rejects core and cross-company promotion requests", async (t) => {
  const f = await fixture(t);
  const decision = await f.decision();
  for (const patch of [{ targetScope: "core" }, { companyId: "foreign" }, { source: { ...source, companyId: "foreign" } }, { type: "cross-company-promotion" }, { targetCompanyId: "foreign" }, { ownerConsent: undefined }]) {
    await writeFile(f.requestPath, JSON.stringify({ ...f.request, ...patch }));
    await assert.rejects(submitApprovalDecision(f.store, decision), /canonical|company|share|instance/i);
  }
});

test("canonical decisions reject changed requests, duplicates, forged issuance and replay", async (t) => {
  const f = await fixture(t);
  const decision = await f.decision();
  await writeFile(f.requestPath, JSON.stringify({ ...f.request, purposes: ["review"] }));
  await assert.rejects(submitApprovalDecision(f.store, decision), /changed|refresh/i);
  await writeFile(f.requestPath, JSON.stringify(f.request));
  const outcomes = await Promise.allSettled([submitApprovalDecision(f.store, decision), submitApprovalDecision(f.store, decision)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  await assert.rejects(submitApprovalDecision(f.store, decision), /decided/i);
  assert.throws(() => consumeApprovalDecision(f.store, structuredClone(f.request), decision), /issued/i);
  const terminal = consumeApprovalDecision(f.store, f.request, decision);
  assert.equal(Object.isFrozen(terminal), true);
  assert.equal(Object.isFrozen(terminal.source), true);
  assert.throws(() => consumeApprovalDecision(f.store, f.request, decision), /decided/i);
  await writeFile(f.requestPath, JSON.stringify({ ...f.request, consumerStyleIds: ["owner"] }));
  await assert.rejects(readApprovalDecision(f.store, "share-001"), /match/i);
});

for (const [name, patch] of [
  ["version", { version: "2.0.0" }], ["hash", { sha256: "0".repeat(64) }],
  ["purpose", { allowedPurposes: ["generate", "review"] }],
  ["consumer set", { exportPolicy: { mode: "allow-listed", consumerStyleIds: ["consumer", "owner"] } }],
  ["status", { status: "deprecated" }],
] as const) {
  test(`live ${name} changes revoke an existing share approval even with an older registry`, async (t) => {
    const f = await fixture(t);
    await f.approve();
    f.setResource({ ...resource, ...patch } as ResourceRecord);
    await f.save();
    await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /registered|purpose|consumer|approved|export/i);
  });
}

test("live imports and owner membership remain required after approval", async (t) => {
  const f = await fixture(t);
  await f.approve();
  f.manifests[1] = { ...f.manifests[1], imports: [] };
  await f.save();
  await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /import/i);
  // An import change can be validated before it is committed, using the canonical approval.
  await validateStyleImportChange(f.registry, { ...f.manifests[1], imports: [source] }, ["share-001"]);
  f.manifests[1] = { ...f.manifests[1], imports: [source] };
  f.manifests[0] = { ...f.manifests[0], ownedResources: [] };
  await f.save();
  await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /owner/i);
});

test("import validation permits revocation but rejects missing approvals, foreign imports and core promotion", async (t) => {
  const f = await fixture(t);
  await f.approve();
  await validateStyleImportChange(f.registry, { ...f.manifests[1], imports: [] }, []);
  await assert.rejects(validateStyleImportChange(f.registry, f.manifests[1], []), /approval/i);
  for (const ref of [{ ...source, companyId: "foreign" }, { ...source, scope: "core", companyId: undefined, styleId: undefined }, { ...source, version: "2.0.0" }]) {
    await assert.rejects(validateStyleImportChange(f.registry, { ...f.manifests[1], imports: [ref] } as StyleManifest, ["share-001"]), /company|core|approval|registered/i);
  }
  await assert.rejects(validateStyleImportChange(f.registry, { ...f.manifests[1], companyId: "foreign" }, ["share-001"]), /company/i);
});

test("rejection never validates a resource share", async (t) => {
  const f = await fixture(t);
  await submitApprovalDecision(f.store, { ...await f.decision(), decision: { action: "reject", reason: "No consent to distribute" } });
  await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /approved|rejected/i);
});

test("company-owned resources can be shared without a fictitious style owner", async (t) => {
  const f = await fixture(t);
  const companySource: ResourceRef = { ...source, scope: "company", styleId: undefined };
  f.setResource({ ...resource, ...companySource });
  f.manifests[1] = { ...f.manifests[1], imports: [companySource] };
  await f.save();
  const registry = await openResourceRegistry(f.store, { coreResourcesRoot: f.core });
  const request = proposeResourceShare(registry, { ...proposal(), source: companySource, ownerConsent: undefined });
  await writeFile(f.requestPath, JSON.stringify(request));
  await f.approve();
  assert.equal((await validateApprovedResourceShare(registry, "share-001")).source.scope, "company");
  await validateStyleImportChange(registry, f.manifests[1], ["share-001"]);
});

test("source byte changes invalidate approval even when catalog metadata is unchanged", async (t) => {
  const f = await fixture(t);
  await f.approve();
  await writeFile(join(f.company, resource.path), "changed brand");
  await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /hash/i);
});

test("standalone resource share schema rejects malformed source versions", async (t) => {
  const f = await fixture(t);
  const schema = JSON.parse(await readFile(new URL("../runtime/schemas/resource-share-request.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv.default({ strict: true }).compile(schema);
  assert.equal(validate(f.request), true);
  assert.equal(validate({ ...f.request, source: { ...source, version: "not-semver" } }), false);
});

test("local review exposes company share requests and accepts the same canonical decision", async (t) => {
  const f = await fixture(t);
  const server = await startReviewUi({ store: f.store });
  t.after(() => server.close());
  const pending = await (await fetch(`${server.url}/api/approvals/pending`)).json();
  assert.equal(pending.items[0].request.type, "resource-share");
  assert.equal(pending.items[0].request.source.sha256, source.sha256);
  const evidence = await (await fetch(`${server.url}/api/evidence`)).json();
  assert.deepEqual(evidence.items[0].evidence, []);
  const response = await fetch(`${server.url}/api/approvals`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await f.decision()),
  });
  assert.equal(response.status, 201);
  assert.equal((await validateApprovedResourceShare(f.registry, "share-001")).companyId, "acme");
});

test("request replacement during decision reads cannot approve a widened purpose snapshot", async (t) => {
  const f = await fixture(t);
  await f.approve();
  f.setResource({ ...resource, allowedPurposes: ["generate", "review"] });
  await f.save();
  await writeFile(f.requestPath, JSON.stringify({ ...f.request, purposes: ["generate", "review"] }));
  const resolve = f.store.resolve.bind(f.store);
  // Deterministically interleave a real file replacement between the two reads.
  f.store.resolve = (ref) => {
    if (ref === "approvals/decisions/share-001.json") writeFileSync(f.requestPath, JSON.stringify(f.request));
    return resolve(ref);
  };
  await assert.rejects(validateApprovedResourceShare(f.registry, "share-001"), /match|changed/i);
});

test("import matching and approval validation bind the same request snapshot", async (t) => {
  const f = await fixture(t);
  await f.approve();
  const unapprovedSource = { ...source, version: "9.0.0" };
  await writeFile(f.requestPath, JSON.stringify({ ...f.request, source: unapprovedSource }));
  const resolve = f.store.resolve.bind(f.store);
  let requestReads = 0;
  // The first snapshot matches v9; restore approved v1 before the next read.
  f.store.resolve = (ref) => {
    if (ref === "approvals/requests/share-001.json" && ++requestReads === 2) {
      writeFileSync(f.requestPath, JSON.stringify(f.request));
    }
    return resolve(ref);
  };
  await assert.rejects(validateStyleImportChange(f.registry, {
    ...f.manifests[1], imports: [unapprovedSource, source],
  }, ["share-001"]), /match|changed|registered/i);
});
