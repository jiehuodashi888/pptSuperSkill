import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { openInstance } from "../runtime/src/instances/store.js";
import { openResourceRegistry } from "../runtime/src/resources/registry.js";
import { isAuthenticResolvedResource, resolveResource } from "../runtime/src/resources/resolver.js";
import type { ResourceRecord, ResourceRef, ResourceRegistry, StyleManifest } from "../runtime/src/resources/types.js";

const contents = "approved template bytes";
const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const access = { companyId: "acme", styleId: "annual", purpose: "generate" as const };
const record: ResourceRecord = {
  resourceId: "annual-template", scope: "style", companyId: "acme", styleId: "annual",
  version: "1.0.0", sha256: digest(contents), kind: "template",
  path: "resources/styles/annual/template.txt", status: "approved",
  allowedPurposes: ["observe", "route", "generate", "qa", "review"],
};
const reference = ({ resourceId, scope, companyId, styleId, version, sha256 }: ResourceRef): ResourceRef => ({
  resourceId, scope, ...(companyId ? { companyId } : {}), ...(styleId ? { styleId } : {}), version, sha256,
});
const manifest = (styleId: string, ownedResources: ResourceRef[] = [], imports: ResourceRef[] = []): StyleManifest => ({
  companyId: "acme", styleId, status: "approved", ownedResources, imports,
});

async function fixture(t: test.TestContext, resource: ResourceRecord = record, manifests = [
  manifest("annual", [reference(resource)]), manifest("technical"),
]) {
  const root = await mkdtemp(join(tmpdir(), "resource-resolver-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const companyRoot = join(root, "acme");
  const coreRoot = join(root, "core");
  await mkdir(join(companyRoot, "resources"), { recursive: true });
  await mkdir(coreRoot);
  await writeFile(join(companyRoot, "instance.yaml"), JSON.stringify({ company_id: "acme", core_version: "0.1.0", assets: [], resource_catalog: "resources/catalog.json", resource_catalog_version: "1.0.0" }));
  const manifestRecords: ResourceRecord[] = [];
  for (const entry of manifests) {
    const bytes = JSON.stringify(entry);
    const path = `styles/${entry.styleId}/manifest.json`;
    await mkdir(dirname(join(companyRoot, path)), { recursive: true });
    await writeFile(join(companyRoot, path), bytes);
    manifestRecords.push({
      ...record, resourceId: `${entry.styleId}-manifest`, kind: "style-manifest", styleId: entry.styleId,
      path, sha256: digest(bytes),
    });
  }
  const catalog = { catalogVersion: "1.0.0", resources: [...manifestRecords, ...(resource.scope === "core" ? [] : [resource])] };
  const saveCatalog = () => writeFile(join(companyRoot, "resources/catalog.json"), JSON.stringify(catalog));
  await saveCatalog();
  await writeFile(join(coreRoot, "core-catalog.json"), JSON.stringify({ catalogVersion: "1.0.0", resources: resource.scope === "core" ? [resource] : [] }));
  const resourcePath = join(resource.scope === "core" ? coreRoot : companyRoot, resource.path);
  await mkdir(dirname(resourcePath), { recursive: true });
  await writeFile(resourcePath, contents);
  const store = await openInstance(root, "acme");
  const reopen = () => openResourceRegistry(store, { coreResourcesRoot: coreRoot });
  return { root, companyRoot, coreRoot, resourcePath, catalog, saveCatalog, reopen, registry: await reopen() };
}

test("own approved registered resource resolves with authentic immutable metadata and protected bytes", async (t) => {
  const { registry, resourcePath } = await fixture(t);
  const ref = reference(record);
  const context = { ...access };
  const result = await resolveResource(registry, ref, context);
  assert.equal(result.path, await realpath(resourcePath));
  assert.equal(Buffer.from(result.bytes).toString(), contents);
  assert.equal(isAuthenticResolvedResource(result), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.ref), true);
  assert.equal(Object.isFrozen(result.access), true);
  result.bytes[0] = 0;
  assert.equal(Buffer.from(result.bytes).toString(), contents);
  context.styleId = "technical";
  assert.equal(result.access.styleId, "annual");
  assert.equal(isAuthenticResolvedResource({ ...result }), false);
  assert.equal(isAuthenticResolvedResource(Object.create(result)), false);
  assert.equal(isAuthenticResolvedResource(null), false);
});

test("same-company private resource is denied before resolving or opening its missing file", async (t) => {
  const { registry, resourcePath } = await fixture(t);
  await unlink(resourcePath);
  await assert.rejects(() => resolveResource(registry, reference(record), { ...access, styleId: "technical" }), /access denied/i);
});

test("forged registry cannot mint authentic handles", async (t) => {
  const { registry } = await fixture(t);
  await assert.rejects(() => resolveResource({ ...registry } as ResourceRegistry, reference(record), access), /registry/i);
});

const company: ResourceRecord = {
  ...record, resourceId: "brand", scope: "company", styleId: undefined, path: "resources/company/brand.txt",
  exportPolicy: { mode: "allow-listed", consumerStyleIds: ["annual"] },
};
for (const [exports, imports, allowed] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]] as const) {
  test(`company sharing requires both export and import: export=${exports}, import=${imports}`, async (t) => {
    const shared = { ...company, exportPolicy: exports ? company.exportPolicy : undefined };
    const { registry } = await fixture(t, shared, [manifest("annual", [], imports ? [reference(shared)] : [])]);
    const result = resolveResource(registry, reference(shared), access);
    if (allowed) assert.equal(isAuthenticResolvedResource(await result), true);
    else await assert.rejects(() => result, /access denied/i);
  });
}

test("cross-style resource requires both owner export and exact consumer import", async (t) => {
  const shared = { ...record, exportPolicy: { mode: "allow-listed" as const, consumerStyleIds: ["technical"] } };
  const { registry } = await fixture(t, shared, [manifest("annual", [reference(shared)]), manifest("technical", [], [reference(shared)])]);
  assert.equal(isAuthenticResolvedResource(await resolveResource(registry, reference(shared), { ...access, styleId: "technical" })), true);
});

test("foreign company contexts and refs are denied", async (t) => {
  const { registry } = await fixture(t);
  await assert.rejects(() => resolveResource(registry, reference(record), { ...access, companyId: "foreign" }), /company/i);
  await assert.rejects(() => resolveResource(registry, { ...reference(record), companyId: "foreign" }, access), /company/i);
});

for (const status of ["candidate", "deprecated", "rejected"] as const) {
  for (const purpose of ["route", "generate", "qa"] as const) {
    test(`${status} resource cannot serve ${purpose}`, async (t) => {
      const { registry } = await fixture(t, { ...record, status });
      await assert.rejects(() => resolveResource(registry, reference(record), { ...access, purpose }), /approved/i);
    });
  }
}

for (const scope of ["request", "quarantine"] as const) {
  for (const purpose of ["observe", "route", "generate", "qa", "review"] as const) {
    test(`phase 1/2 rejects ${scope} even for ${purpose}`, async (t) => {
      const blocked = { ...record, scope };
      const { registry } = await fixture(t, blocked);
      await assert.rejects(() => resolveResource(registry, reference(blocked), { ...access, purpose }), /scope/i);
    });
  }
}

test("declared purposes remain mandatory even for approved resources", async (t) => {
  const { registry } = await fixture(t, { ...record, allowedPurposes: ["review"] });
  await assert.rejects(() => resolveResource(registry, reference(record), access), /purpose/i);
});

test("candidate resources can be explicitly observed by their owner", async (t) => {
  const { registry } = await fixture(t, { ...record, status: "candidate" });
  assert.equal(isAuthenticResolvedResource(await resolveResource(registry, reference(record), { ...access, purpose: "observe" })), true);
});

test("exact registered identity and valid refs are mandatory", async (t) => {
  const { registry } = await fixture(t);
  for (const patch of [{ resourceId: "unknown" }, { version: "2.0.0" }, { sha256: "0".repeat(64) }, { styleId: "technical" }, { version: "no-version" }, { sha256: "bad-hash" }, { path: record.path }]) {
    await assert.rejects(() => resolveResource(registry, { ...reference(record), ...patch }, access), /reference|registered/i);
  }
});

test("missing or unapproved consumer and missing ownership are denied", async (t) => {
  const { registry } = await fixture(t, record, [{ ...manifest("annual"), status: "candidate" }]);
  for (const styleId of [undefined, "missing", "annual"]) {
    await assert.rejects(() => resolveResource(registry, reference(record), { ...access, styleId }), /access denied/i);
  }
  const other = await fixture(t, record, [manifest("annual")]);
  await assert.rejects(() => resolveResource(other.registry, reference(record), access), /access denied/i);
});

test("resource bytes are rehashed on every resolution", async (t) => {
  const { registry, resourcePath } = await fixture(t);
  await resolveResource(registry, reference(record), access);
  await writeFile(resourcePath, "replacement bytes");
  await assert.rejects(() => resolveResource(registry, reference(record), access), /hash/i);
});

test("company catalog paths behind an escaping directory link are denied", async (t) => {
  const linked = { ...record, path: "linked/template.txt" };
  const { registry, root, companyRoot, resourcePath } = await fixture(t, linked);
  await rm(dirname(resourcePath), { recursive: true });
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "template.txt"), contents);
  await symlink(outside, join(companyRoot, "linked"), "junction");
  await assert.rejects(() => resolveResource(registry, reference(linked), access), /canonical root/i);
});

test("missing catalog resource parent is denied", async (t) => {
  const { registry, resourcePath } = await fixture(t);
  await rm(dirname(resourcePath), { recursive: true });
  await assert.rejects(() => resolveResource(registry, reference(record), access), /ENOENT/i);
});

test("core resources use only the canonical core root and exact imports", async (t) => {
  const core: ResourceRecord = { ...record, scope: "core", companyId: undefined, styleId: undefined, path: "tokens/base.txt" };
  const { registry, root, coreRoot, resourcePath } = await fixture(t, core, [manifest("annual", [], [reference(core)])]);
  assert.equal(isAuthenticResolvedResource(await resolveResource(registry, reference(core), access)), true);
  await rm(dirname(resourcePath), { recursive: true });
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "base.txt"), contents);
  await symlink(outside, join(coreRoot, "tokens"), "junction");
  await assert.rejects(() => resolveResource(registry, reference(core), access), /canonical root/i);
});

test("company export revocation applies to a newly opened registry", async (t) => {
  const setup = await fixture(t, company, [manifest("annual", [], [reference(company)])]);
  await resolveResource(setup.registry, reference(company), access);
  setup.catalog.resources[setup.catalog.resources.length - 1] = { ...company, exportPolicy: undefined };
  await setup.saveCatalog();
  await assert.rejects(() => setup.reopen().then((registry) => resolveResource(registry, reference(company), access)), /access denied/i);
});

test("manifest hash drift cannot change authorization", async (t) => {
  const setup = await fixture(t, company, [manifest("annual")]);
  await writeFile(join(setup.companyRoot, "styles/annual/manifest.json"), JSON.stringify(manifest("annual", [], [reference(company)])));
  await assert.rejects(() => setup.reopen(), /hash/i);
});

test("consumer import revocation and version drift apply to a newly opened registry", async (t) => {
  const setup = await fixture(t, company, [manifest("annual", [], [reference(company)])]);
  await resolveResource(setup.registry, reference(company), access);
  for (const imports of [[], [{ ...reference(company), version: "2.0.0" }]]) {
    const bytes = JSON.stringify(manifest("annual", [], imports));
    await writeFile(join(setup.companyRoot, "styles/annual/manifest.json"), bytes);
    setup.catalog.resources[0] = { ...setup.catalog.resources[0], sha256: digest(bytes) };
    await setup.saveCatalog();
    await assert.rejects(() => setup.reopen().then((registry) => resolveResource(registry, reference(company), access)), /access denied/i);
  }
});
