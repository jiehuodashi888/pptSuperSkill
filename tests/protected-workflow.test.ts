import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { runProtectedWorkflow, type ProtectedWorkflowInput } from "../runtime/src/workflow/protected.js";
import type { ResourceRecord, ResourceRef, RuntimeDeploymentConfig } from "../runtime/src/resources/types.js";
import { openInstance } from "../runtime/src/instances/store.js";
import { openResourceRegistry } from "../runtime/src/resources/registry.js";
import { validateInstance } from "../runtime/src/instances/validate.js";

const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t: test.TestContext, foreign?: "company" | "style", qaAllowed = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "protected-workflow-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deployment: RuntimeDeploymentConfig = { instancesRoot: join(root, "instances"), coreResourcesRoot: join(root, "core"), outputRoot: join(root, "output"), cacheRoot: join(root, "cache") };
  const company = join(deployment.instancesRoot, "acme");
  await mkdir(join(company, "resources"), { recursive: true });
  await mkdir(deployment.coreResourcesRoot);
  await writeFile(join(company, "instance.yaml"), JSON.stringify({ company_id: "acme", core_version: "0.1.0", assets: [], resource_catalog: "resources/catalog.json", resource_catalog_version: "1.0.0" }));
  await writeFile(join(deployment.coreResourcesRoot, "core-catalog.json"), JSON.stringify({ catalogVersion: "1.0.0", resources: [] }));
  const records: ResourceRecord[] = [];
  async function add(id: string, kind: ResourceRecord["kind"], content: unknown): Promise<ResourceRef> {
    const bytes = JSON.stringify(content);
    const ref: ResourceRef = { resourceId: id, scope: "style", companyId: "acme", styleId: "annual", version: "1.0.0", sha256: hash(bytes) };
    const path = `resources/styles/annual/${id}.json`;
    records.push({ ...ref, kind, path, status: "approved", allowedPurposes: qaAllowed ? ["route", "generate", "qa"] : ["route", "generate"] });
    await mkdir(dirname(join(company, path)), { recursive: true });
    await writeFile(join(company, path), bytes);
    return ref;
  }
  const template = await add("template", "template", {});
  const tokens = await add("tokens", "token-set", { status: "approved", width: 10, height: 6, backgroundColor: "FFFFFF", titleColor: "112233", bodyColor: "334455", titleFontFace: "Arial", bodyFontFace: "Arial", titleFontSize: 32, bodyFontSize: 18 });
  const layout = await add("layout", "layout", { id: "opening", status: "approved", title: { x: 1, y: 1, w: 8, h: 1 }, body: { x: 1, y: 3, w: 8, h: 2 } });
  await add("manifest", "style-manifest", { companyId: "acme", styleId: "annual", status: "approved", businessTypes: ["report"], audiences: ["board"], ownedResources: [{ ...template, ...(foreign === "company" ? { companyId: "beta" } : foreign === "style" ? { styleId: "technical" } : {}) }, tokens, layout], imports: [] });
  await writeFile(join(company, "resources/catalog.json"), JSON.stringify({ catalogVersion: "1.0.0", resources: records }));
  const input: ProtectedWorkflowInput = { companyId: "acme", requestId: "request-1", request: { businessType: "report", audience: "board" }, slides: [{ layoutId: "opening", title: "Protected report", body: "Registered resources only" }], capabilities: { pptxRead: true, pptxWrite: true, renderSlides: false, imageAnalysis: false, parallelAgents: false } };
  return { root, deployment, input };
}

test("shipped example completes protected generation and resource-bound QA setup", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "example-protected-workflow-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await runProtectedWorkflow({
    companyId: "example-company", requestId: "example-smoke",
    request: { businessType: "example-report", audience: "general" },
    slides: [{ layoutId: "title-body", title: "Example smoke test", body: "Shipped registered resources" }],
    capabilities: { pptxRead: true, pptxWrite: true, renderSlides: false, imageAnalysis: false, parallelAgents: false },
  }, {
    instancesRoot: resolve("instances"), coreResourcesRoot: resolve("runtime/core-resources"),
    outputRoot: join(root, "output"), cacheRoot: join(root, "cache"),
  });
  assert.equal(report.generatedDeck.status, "created");
  assert.equal(report.styleId, "default");
  const zip = await JSZip.loadAsync(await readFile(report.generatedDeck.outputPath));
  assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /Shipped registered resources/);
  assert.equal(report.audit.status, "incomplete");
  assert.equal(report.audit.coverage.complete, false);
  assert.deepEqual(report.audit.resourceAudit?.resources.map((ref) => ref.resourceId).sort(),
    ["approved-scenario-mappings", "default-layouts", "default-manifest", "default-tokens"]);
});

for (const scenario of ["legacy", "version-without-opt-in", "declared-version-mismatch", "unsupported-company-version", "unsupported-core-version"] as const) {
  test(`registry and production reject ${scenario} before creating output or cache`, async (t) => {
    const { deployment, input } = await fixture(t);
    const company = join(deployment.instancesRoot, "acme");
    const instancePath = join(company, "instance.yaml");
    const instance = JSON.parse(await readFile(instancePath, "utf8"));
    if (scenario === "legacy" || scenario === "version-without-opt-in") delete instance.resource_catalog;
    if (scenario === "legacy") delete instance.resource_catalog_version;
    if (scenario === "declared-version-mismatch") instance.resource_catalog_version = "1.0.1";
    if (scenario === "unsupported-company-version") instance.resource_catalog_version = "2.0.0";
    await writeFile(instancePath, JSON.stringify(instance));
    if (scenario.startsWith("unsupported-")) {
      const path = scenario === "unsupported-company-version" ? join(company, "resources/catalog.json") : join(deployment.coreResourcesRoot, "core-catalog.json");
      const catalog = JSON.parse(await readFile(path, "utf8"));
      catalog.catalogVersion = "2.0.0";
      await writeFile(path, JSON.stringify(catalog));
    }
    const expected = scenario === "legacy" || scenario === "version-without-opt-in" ? /opt.in|resource_catalog/i : /version/i;
    await assert.rejects(openResourceRegistry(await openInstance(deployment.instancesRoot, "acme"), deployment), expected);
    await assert.rejects(runProtectedWorkflow(input, deployment), expected);
    await assert.rejects(readdir(deployment.outputRoot), { code: "ENOENT" });
    await assert.rejects(readdir(deployment.cacheRoot), { code: "ENOENT" });
    if (scenario === "legacy") assert.equal((await validateInstance(company)).resourceCatalog, "legacy");
  });
}

test("registry accepts an opted-in supported catalog without an optional declared version", async (t) => {
  const { deployment } = await fixture(t);
  const path = join(deployment.instancesRoot, "acme", "instance.yaml");
  const instance = JSON.parse(await readFile(path, "utf8"));
  delete instance.resource_catalog_version;
  await writeFile(path, JSON.stringify(instance));
  const registry = await openResourceRegistry(await openInstance(deployment.instancesRoot, "acme"), deployment);
  assert.equal(registry.companyCatalog.catalogVersion, "1.0.0");
});

test("protected workflow generates only derived namespaces and records resource-bound incomplete QA", async (t) => {
  const { deployment, input } = await fixture(t);
  const report = await runProtectedWorkflow(input, deployment);
  assert.equal(report.classification, "production");
  assert.equal(report.generatedDeck.outputPath, join(deployment.outputRoot, "acme", "annual", "request-1", "presentation.pptx"));
  assert.match(report.resourceVersionSetHash, /^[0-9a-f]{64}$/);
  assert.equal(report.cacheDirectory, join(deployment.cacheRoot, "acme", "annual", report.resourceVersionSetHash, "request-1"));
  assert.deepEqual(await readdir(report.cacheDirectory), []);
  const zip = await JSZip.loadAsync(await readFile(report.generatedDeck.outputPath));
  assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /Registered resources only/);
  assert.equal(report.audit.status, "incomplete");
  assert.equal(report.audit.coverage.complete, false);
  assert.equal(report.audit.visual.status, "not-run");
  assert.match(report.audit.coverage.gaps.join(" "), /renderSlides.*imageAnalysis/);
  assert.equal(report.audit.resourceAudit?.resourceVersionSetHash, report.resourceVersionSetHash);
  assert.equal(report.audit.resourceAudit?.requestId, "request-1");
  assert.equal(report.audit.resourceAudit?.resources.length, 4);
  assert.ok(report.audit.resourceAudit?.resources.every((ref) => !Object.hasOwn(ref, "path")));
  const second = await runProtectedWorkflow({ ...input, requestId: "request-2" }, deployment);
  assert.equal(second.resourceVersionSetHash, report.resourceVersionSetHash);
  assert.notEqual(second.cacheDirectory, report.cacheDirectory);
});

test("release provenance identifies the isolated run without resource paths or bytes", async (t) => {
  const { deployment, input } = await fixture(t);
  const report = await runProtectedWorkflow(input, deployment);
  assert.ok(report.resourceProvenance, "protected release report must expose safe resource provenance");
  const provenance = report.resourceProvenance;
  assert.deepEqual(Object.keys(provenance).sort(), ["companyId", "requestId", "resourceVersionSetHash", "resources", "styleId"]);
  assert.equal(provenance.companyId, "acme");
  assert.equal(provenance.styleId, "annual");
  assert.equal(provenance.requestId, "request-1");
  assert.match(provenance.resourceVersionSetHash, /^[0-9a-f]{64}$/);
  assert.equal(report.outputDirectory, join(deployment.outputRoot, "acme", "annual", "request-1"));
  assert.equal(report.cacheDirectory, join(deployment.cacheRoot, "acme", "annual", provenance.resourceVersionSetHash, "request-1"));
  assert.deepEqual(provenance.resources.map((ref) => ref.resourceId).sort(), ["layout", "manifest", "template", "tokens"]);
  for (const ref of provenance.resources) {
    assert.deepEqual(Object.keys(ref).sort(), ["companyId", "resourceId", "scope", "sha256", "styleId", "version"]);
    assert.equal(ref.companyId, "acme");
    assert.equal(ref.styleId, "annual");
    assert.equal(ref.scope, "style");
    assert.equal(ref.version, "1.0.0");
    assert.match(ref.sha256, /^[0-9a-f]{64}$/);
  }
  assert.ok(Object.isFrozen(provenance));
  assert.ok(Object.isFrozen(provenance.resources));
});

test("cross-company resource denial precedes creation of output and cache namespaces", async (t) => {
  const { deployment, input } = await fixture(t, "company");
  await assert.rejects(runProtectedWorkflow(input, deployment), /foreign|registered|access denied/i);
  await assert.rejects(readdir(deployment.outputRoot), { code: "ENOENT" });
  await assert.rejects(readdir(deployment.cacheRoot), { code: "ENOENT" });
});

test("protected workflow rejects invalid identifiers before opening the deployment", async (t) => {
  const { deployment, input } = await fixture(t);
  for (const requestId of ["", "../escape", "a/b", "a\\b", "a:stream", "CON", "nul", "a ", "a.", "a".repeat(64)]) {
    await assert.rejects(runProtectedWorkflow({ ...input, requestId }, deployment), /request.*id/i);
  }
  await assert.rejects(runProtectedWorkflow({ ...input, companyId: "../beta" }, deployment), /company.*id/i);
  await assert.rejects(readFile(join(deployment.outputRoot, "acme", "annual", "request-1", "presentation.pptx")), /ENOENT/);
});

test("production rejects supplied paths, routes, styles, resources, adapters and fixture reports", async (t) => {
  const { deployment, input } = await fixture(t);
  for (const extra of [{ outputDirectory: join(deployment.outputRoot, "escape") }, { cacheDirectory: "escape" }, { route: { companyId: "acme", styleId: "annual" } }, { library: {} }, { resources: [] }, { templateRefs: ["evil.pptx"] }, { styleId: "technical" }, { pagePlan: {} }, { classification: "test-only" }, { qa: {} }, { adapters: [] }]) {
    await assert.rejects(runProtectedWorkflow({ ...input, ...extra } as ProtectedWorkflowInput, deployment), /unsupported|unexpected|test-only/i);
  }
  await assert.rejects(runProtectedWorkflow({ ...input, request: { ...input.request, route: {} } } as ProtectedWorkflowInput, deployment), /unsupported|unexpected/i);
});

test("production rejects foreign company and foreign style resource references", async (t) => {
  for (const owner of ["company", "style"] as const) {
    const { deployment, input } = await fixture(t, owner);
    await assert.rejects(runProtectedWorkflow(input, deployment), /foreign|registered|access denied/i);
  }
});

test("QA authorization failure prevents generation even without visual capabilities", async (t) => {
  const { deployment, input } = await fixture(t, undefined, false);
  await assert.rejects(runProtectedWorkflow(input, deployment), /purpose/i);
  await assert.rejects(readFile(join(deployment.outputRoot, "acme", "annual", "request-1", "presentation.pptx")), /ENOENT/);
});

test("production refuses output and cache directory links before writing outside roots", async (t) => {
  for (const kind of ["outputRoot", "cacheRoot"] as const) {
    const { root, deployment, input } = await fixture(t);
    const outside = join(root, "outside");
    await mkdir(outside);
    await mkdir(deployment[kind]);
    await symlink(outside, join(deployment[kind], "acme"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(runProtectedWorkflow(input, deployment), /link|junction|canonical|escape/i);
    assert.deepEqual(await readdir(outside), []);
    await unlink(join(deployment[kind], "acme"));
  }
});

test("declared capabilities alone cannot claim QA coverage and repeated requests never overwrite", async (t) => {
  const { deployment, input } = await fixture(t);
  const report = await runProtectedWorkflow({ ...input, capabilities: { ...input.capabilities, renderSlides: true, imageAnalysis: true } }, deployment);
  assert.equal(report.audit.coverage.complete, false);
  assert.match(report.audit.coverage.gaps.join(" "), /adapter unavailable/);
  const bytes = await readFile(report.generatedDeck.outputPath);
  await assert.rejects(runProtectedWorkflow(input, deployment), /exist/i);
  assert.deepEqual(await readFile(report.generatedDeck.outputPath), bytes);
});

test("a newly approved resource version changes the cache and QA version-set identity", async (t) => {
  const { deployment, input } = await fixture(t);
  const first = await runProtectedWorkflow(input, deployment);
  const company = join(deployment.instancesRoot, "acme");
  const catalogPath = join(company, "resources/catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const tokenRecord = catalog.resources.find((record: ResourceRecord) => record.kind === "token-set");
  const tokenPath = join(company, tokenRecord.path);
  const changedTokens = JSON.stringify({ ...JSON.parse(await readFile(tokenPath, "utf8")), titleColor: "445566" });
  await writeFile(tokenPath, changedTokens);
  tokenRecord.version = "2.0.0";
  tokenRecord.sha256 = hash(changedTokens);
  const manifestRecord = catalog.resources.find((record: ResourceRecord) => record.kind === "style-manifest");
  const manifestPath = join(company, manifestRecord.path);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const tokenRef = manifest.ownedResources.find((ref: ResourceRef) => ref.resourceId === "tokens");
  tokenRef.version = tokenRecord.version;
  tokenRef.sha256 = tokenRecord.sha256;
  const manifestBytes = JSON.stringify(manifest);
  await writeFile(manifestPath, manifestBytes);
  manifestRecord.version = "2.0.0";
  manifestRecord.sha256 = hash(manifestBytes);
  await writeFile(catalogPath, JSON.stringify(catalog));
  const second = await runProtectedWorkflow({ ...input, requestId: "request-2" }, deployment);
  assert.notEqual(second.resourceVersionSetHash, first.resourceVersionSetHash);
  assert.equal(second.audit.resourceAudit?.resources.find((ref) => ref.resourceId === "tokens")?.version, "2.0.0");
  assert.notEqual(dirname(second.cacheDirectory), dirname(first.cacheDirectory));
});
