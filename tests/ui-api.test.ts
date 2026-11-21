import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import test from "node:test";

import { openInstance } from "../runtime/src/instances/store.js";
import { proposeClassification } from "../runtime/src/contracts/taxonomy.js";
import { consumeApprovalDecision, readApprovalDecision, submitApprovalDecision } from "../runtime/src/approvals/files.js";
import { startReviewUi, type ReviewUiServer } from "../runtime/src/ui/server.js";

const candidate = () => proposeClassification({
  proposal_id: "proposal-001", dimension: "visual_style",
  candidate: { id: "editorial", name: "Editorial", tags: ["serif"] },
  evidence: [{ source_id: "deck-001", slide_number: 1, element_ref: "title", source_type: "pptx-structure", locator: "deck-001/slide1.xml#title" }],
  proposed_by: "style-observer",
});

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ppt-ui-"));
  const company = join(root, "example-company");
  await mkdir(join(company, "approvals", "requests"), { recursive: true });
  await mkdir(join(company, "review"));
  await writeFile(join(company, "instance.yaml"), JSON.stringify({ company_id: "example-company", core_version: "0.1.0", assets: [] }));
  const requestPath = join(company, "approvals", "requests", "proposal-001.json");
  await writeFile(requestPath, JSON.stringify(candidate()));
  await writeFile(join(company, "review", "routing.json"), JSON.stringify({ selectedStyleRefs: [], requires_confirmation: true }));
  await writeFile(join(company, "review", "audit.json"), JSON.stringify({ complete: false, unresolved: [{ type: "candidate-classification", message: "Needs review", references: ["proposal-001"] }] }));
  const store = await openInstance(root, "example-company");
  let server: ReviewUiServer | undefined;
  t.after(async () => { await server?.close(); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  server = await startReviewUi({ store });
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${server!.url}/api/approvals`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const pending = async () => (await (await fetch(`${server!.url}/api/approvals/pending`)).json()).items;
  const decision = async () => ({ companyId: "example-company", request_id: "proposal-001", request_hash: (await pending())[0].request_hash, decision: { action: "approve" } });
  return { root, company, requestPath, store, server, post, pending, decision };
}

test("local review reads canonical records and writes decisions consumable without the UI", async (t) => {
  const f = await fixture(t);
  const items = await f.pending();
  assert.equal(items[0].companyId, "example-company");
  assert.equal(items[0].request.change.candidate.name, "Editorial");
  const evidence = await (await fetch(`${f.server.url}/api/evidence`)).json();
  assert.equal(evidence.items[0].evidence[0].source_id, "deck-001");
  const routing = await (await fetch(`${f.server.url}/api/routing`)).json();
  assert.equal(routing.record.requires_confirmation, true);
  const audit = await (await fetch(`${f.server.url}/api/audit`)).json();
  assert.equal(audit.record.unresolved[0].message, "Needs review");
  const response = await f.post(await f.decision());
  assert.equal(response.status, 201);
  assert.deepEqual(await f.pending(), []);
  await f.server.close();
  const saved = await readApprovalDecision(f.store, "proposal-001");
  assert.equal(consumeApprovalDecision(f.store, candidate(), saved!).status, "approved");
  assert.equal(JSON.parse(await readFile(join(f.company, "approvals/decisions/proposal-001.json"), "utf8")).decision.action, "approve");
});

test("file-only clients share canonical decisions and cannot consume a foreign company decision", async (t) => {
  const f = await fixture(t);
  const decision = await f.decision();
  await f.server.close();
  const saved = await submitApprovalDecision(f.store, { ...decision, decision: { action: "reject", reason: "Insufficient support" } });
  assert.throws(() => consumeApprovalDecision(f.store, candidate(), { ...saved, companyId: "other-company" }), /instance|company/i);
  assert.equal(consumeApprovalDecision(f.store, candidate(), saved).status, "rejected");
  assert.throws(() => consumeApprovalDecision(f.store, structuredClone(candidate()), saved), /issued classification proposal/i);
});

test("foreign evidence and foreign review records fail closed", async (t) => {
  const f = await fixture(t);
  const proposed = candidate();
  await writeFile(f.requestPath, JSON.stringify({ ...proposed, evidence: [{ ...proposed.evidence[0], source_id: "other-company:deck" }] }));
  assert.equal((await fetch(`${f.server.url}/api/approvals/pending`)).status, 422);
  await writeFile(join(f.company, "review/routing.json"), JSON.stringify({ companyId: "other-company", selectedStyleRefs: ["secret"] }));
  const response = await fetch(`${f.server.url}/api/routing`);
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /secret/);
});

test("file submission snapshots validated input before asynchronous disk access", async (t) => {
  const f = await fixture(t);
  const value = await f.decision();
  const submission = submitApprovalDecision(f.store, value);
  value.companyId = "other-company";
  value.decision.action = "publish";
  await submission;
  const saved = await readApprovalDecision(f.store, "proposal-001");
  assert.equal(saved!.companyId, "example-company");
  assert.equal(saved!.decision.action, "approve");
});

test("decision directory junctions cannot write outside the selected store", async (t) => {
  const f = await fixture(t);
  const decision = await f.decision();
  const outside = join(f.root, "other-company");
  await mkdir(outside);
  await symlink(outside, join(f.company, "approvals/decisions"), "junction");
  try {
    assert.equal((await f.post(decision)).status, 422);
    await assert.rejects(readFile(join(outside, "proposal-001.json")), { code: "ENOENT" });
  } finally { await unlink(join(f.company, "approvals/decisions")); }
});

test("decisions reject foreign companies, missing requests, forged actions and stale requests", async (t) => {
  const f = await fixture(t);
  const good = await f.decision();
  for (const body of [
    { ...good, companyId: "other-company" }, { ...good, request_id: "missing" },
    { ...good, decision: { action: "publish" } }, { ...good, decision: { action: "approve", extra: true } },
    { ...good, request_id: "../escape" }, { ...good, extra: true },
  ]) assert.ok((await f.post(body)).status >= 400);
  await writeFile(f.requestPath, JSON.stringify({ ...candidate(), proposed_by: "changed-observer" }));
  assert.equal((await f.post(good)).status, 409);
  assert.equal((await f.pending()).length, 1);
});

test("exclusive canonical writes prevent duplicate and concurrent approval decisions", async (t) => {
  const f = await fixture(t);
  const good = await f.decision();
  const statuses = await Promise.all([f.post(good), f.post({ ...good, decision: { action: "reject", reason: "Not yet" } })]);
  assert.deepEqual(statuses.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await f.post(good)).status, 409);
});

test("binding and browser-origin guards reject public interfaces and hostile hosts", async (t) => {
  const f = await fixture(t);
  for (const host of ["0.0.0.0", "::", "192.168.1.2", "evil.example"]) {
    await assert.rejects(startReviewUi({ store: f.store, host }), /loopback/i);
  }
  assert.match(f.server.url, /^http:\/\/127\.0\.0\.1:/);
  const good = await f.decision();
  assert.equal((await f.post(good, { origin: "https://evil.example" })).status, 403);
  const hostileHostStatus = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(`${f.server.url}/api/approvals/pending`, { headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on("error", reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await f.post(good, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await f.post(good, { origin: f.server.url })).status, 201);
});

test("chunked oversized JSON receives an HTTP error without breaking the server", async (t) => {
  const f = await fixture(t);
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(`${f.server.url}/api/approvals`, { method: "POST", headers: { "content-type": "application/json", "transfer-encoding": "chunked" } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on("error", reject);
    req.write("x".repeat(40_000)); req.end("x".repeat(40_000));
  });
  assert.equal(status, 413);
  assert.equal((await f.pending()).length, 1);
});

test("HTTP validation rejects malformed JSON, oversized bodies, traversal and invalid methods", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.server.url}/api/approvals`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await fetch(`${f.server.url}/api/approvals`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(70_000) })).status, 413);
  assert.equal((await fetch(`${f.server.url}/api/approvals`, { method: "POST", body: JSON.stringify(await f.decision()) })).status, 415);
  assert.equal((await fetch(`${f.server.url}/api/approvals/pending`, { method: "DELETE" })).status, 405);
  assert.equal((await fetch(`${f.server.url}/api/evidence?ref=other-company:secret.json`)).status, 400);
  for (const path of ["/../instance.yaml", "/%2e%2e/instance.yaml", "/%ZZ", "/app.js/../../instance.yaml"]) {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(f.server.url, { path }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on("error", reject); req.end();
    });
    assert.equal(status, 400);
  }
  assert.equal((await fetch(`${f.server.url}/`)).headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal((await fetch(`${f.server.url}/app.js`)).status, 200);
  assert.equal((await f.pending()).length, 1);
});

test("invalid canonical requests fail closed and store symlinks cannot expose another company", async (t) => {
  const f = await fixture(t);
  await writeFile(f.requestPath, JSON.stringify({ ...candidate(), evidence: [] }));
  assert.equal((await fetch(`${f.server.url}/api/approvals/pending`)).status, 422);
  await writeFile(f.requestPath, JSON.stringify(candidate()));
  const outside = join(f.root, "other-company");
  await mkdir(outside);
  await writeFile(join(outside, "secret.json"), JSON.stringify({ secret: "DO NOT DISCLOSE" }));
  await rm(join(f.company, "review"), { recursive: true });
  await symlink(outside, join(f.company, "review"), "junction");
  try {
    const response = await fetch(`${f.server.url}/api/routing`);
    assert.equal(response.status, 422);
    assert.doesNotMatch(await response.text(), /DO NOT DISCLOSE/);
  } finally { await unlink(join(f.company, "review")); }
});
