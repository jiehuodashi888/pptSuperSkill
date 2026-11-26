import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { openInstance } from "../runtime/src/instances/store.js";
import { openResourceRegistry } from "../runtime/src/resources/registry.js";
import { loadApprovedStyleLibrary } from "../runtime/src/resources/style-library.js";
import { isAuthenticResolvedResource, resolveResource } from "../runtime/src/resources/resolver.js";
import type { ResourceRecord, ResourceRef, StyleManifest } from "../runtime/src/resources/types.js";
import { routeProtectedScenario, requireProtectedRoute, type ResolvedStyleSelection } from "../runtime/src/routing/router.js";
import { prepareGenerationResources, requireGenerationResources } from "../runtime/src/generation/adapter.js";
import { buildProtectedPagePlan, validateProtectedPagePlan } from "../runtime/src/generation/page-plan.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const ref = ({ resourceId, scope, companyId, styleId, version, sha256 }: ResourceRef): ResourceRef => ({
  resourceId, scope, ...(companyId ? { companyId } : {}), ...(styleId ? { styleId } : {}), version, sha256,
});
const context = { companyId: "acme", styleId: "annual", requestId: "request-1", purpose: "generate" as const };
const facts = { businessType: "annual-report", audience: "board" };
const tokens = { status: "approved", width: 10, height: 6, backgroundColor: "FFFFFF", titleColor: "112233", bodyColor: "334455", titleFontFace: "Arial", bodyFontFace: "Arial", titleFontSize: 32, bodyFontSize: 18 };
const layout = { id: "opening", status: "approved", title: { x: 1, y: 1, w: 8, h: 1 }, body: { x: 1, y: 3, w: 8, h: 2 } };
const slides = [{ layoutId: "opening", title: "Annual report", body: "Results" }];

async function fixture(t: test.TestContext, options: {
  mappingStyle?: string; mappingCompany?: string; templateGenerate?: boolean; mappingStatus?: ResourceRecord["status"];
  noImport?: boolean; noExport?: boolean; candidateRecords?: boolean; contentStatus?: StyleManifest["status"];
  companyTokens?: Record<string, unknown>; tokenOverridePolicy?: StyleManifest["tokenOverridePolicy"];
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "protected-routing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const companyRoot = join(root, "acme");
  const coreRoot = join(root, "core");
  await mkdir(join(companyRoot, "resources"), { recursive: true });
  await mkdir(coreRoot);
  await writeFile(join(companyRoot, "instance.yaml"), JSON.stringify({ company_id: "acme", core_version: "0.1.0", assets: [], resource_catalog: "resources/catalog.json", resource_catalog_version: "1.0.0" }));
  await writeFile(join(coreRoot, "core-catalog.json"), JSON.stringify({ catalogVersion: "1.0.0", resources: [] }));
  const records: ResourceRecord[] = [];
  async function add(resourceId: string, kind: ResourceRecord["kind"], path: string, content: unknown, patch: Partial<ResourceRecord> = {}) {
    const bytes = JSON.stringify(content);
    const record: ResourceRecord = { resourceId, kind, path, companyId: "acme", styleId: "annual", scope: "style", version: "1.0.0", sha256: hash(bytes), status: "approved", allowedPurposes: ["route", "generate", "qa"], ...patch };
    await mkdir(dirname(join(companyRoot, path)), { recursive: true });
    await writeFile(join(companyRoot, path), bytes);
    records.push(record);
    return ref(record);
  }
  const template = await add("annual-template", "template", "resources/styles/annual/template.json", {}, { allowedPurposes: options.templateGenerate === false ? ["route"] : ["route", "generate"] });
  const token = await add("annual-tokens", "token-set", "resources/styles/annual/tokens.json", tokens);
  const layouts = await add("annual-layout", "layout", "resources/styles/annual/layout.json", layout);
  const mapping = await add("approved-mappings", "rule-set", "scenarios/approved-mappings.json", { companyId: "acme", mappings: [
    { mappingId: "board-report", companyId: options.mappingCompany ?? "acme", styleId: options.mappingStyle ?? "annual", businessType: "annual-report", status: "approved" },
    { mappingId: "candidate", styleId: "missing", status: "candidate" },
    { mappingId: "deprecated", styleId: "missing", status: "deprecated" },
  ] }, { scope: "company", styleId: undefined, status: options.mappingStatus ?? "approved", exportPolicy: options.noExport ? undefined : { mode: "allow-listed", consumerStyleIds: ["annual"] } });
  const baseline = options.companyTokens && await add("brand-tokens", "token-set", "resources/company/brand.json", options.companyTokens, {
    scope: "company", styleId: undefined, exportPolicy: { mode: "allow-listed", consumerStyleIds: ["annual"] },
  });
  const manifest: StyleManifest = { companyId: "acme", styleId: "annual", status: options.contentStatus ?? "approved", businessTypes: ["annual-report"], audiences: ["board"], ownedResources: [template, token, layouts], imports: options.noImport ? [] : [mapping, ...(baseline ? [baseline] : [])], ...(options.tokenOverridePolicy ? { tokenOverridePolicy: options.tokenOverridePolicy } : {}) };
  await add("annual-manifest", "style-manifest", "styles/annual/manifest.json", manifest);
  if (options.candidateRecords) {
    for (const status of ["candidate", "deprecated"] as const) {
      // The bytes need not be consumed by discovery at all.
      await add(`${status}-manifest`, "style-manifest", `styles/${status}/manifest.json`, {}, { styleId: status, status });
    }
  }
  await writeFile(join(companyRoot, "resources/catalog.json"), JSON.stringify({ catalogVersion: "1.0.0", resources: records }));
  const registry = await openResourceRegistry(await openInstance(root, "acme"), { coreResourcesRoot: coreRoot });
  return { registry, companyRoot, template, token, layouts };
}

test("registered routing preserves scoring and binds verified generation resources", async (t) => {
  const { registry } = await fixture(t, { candidateRecords: true });
  const library = await loadApprovedStyleLibrary(registry);
  const selection = requireProtectedRoute(routeProtectedScenario(facts, library));
  assert.equal(selection.companyId, "acme");
  assert.equal(selection.styleId, "annual");
  assert.equal(selection.candidates.length, 1);
  assert.ok(selection.candidates[0].evidence.includes("approved_mapping:board-report"));
  assert.equal(selection.resources.templates[0].resourceId, "annual-template");
  assert.equal(Object.isFrozen(selection.resources.templates), true);
  const resources = await prepareGenerationResources(selection, registry, context);
  for (const resource of [...resources.templates, ...resources.tokens, ...resources.layouts]) {
    assert.equal(isAuthenticResolvedResource(resource), true);
    assert.equal(resource.access.purpose, "generate");
    assert.equal(resource.access.styleId, "annual");
  }
  const plan = buildProtectedPagePlan(selection, resources, slides);
  assert.equal(plan.tokens.titleColor, "112233");
  assert.equal(plan.layouts[0].id, "opening");
  validateProtectedPagePlan(plan, selection, resources);
  assert.throws(() => validateProtectedPagePlan({ ...plan, tokens: { ...plan.tokens, titleColor: "ABCDEF" } }, selection, resources), /authentic|bound/i);
});

test("candidate and deprecated manifest contents never become protected routes", async (t) => {
  for (const contentStatus of ["candidate", "deprecated"] as const) {
    const { registry } = await fixture(t, { contentStatus, mappingStatus: "candidate" });
    const route = routeProtectedScenario(facts, await loadApprovedStyleLibrary(registry));
    assert.equal(route.requires_confirmation, true);
    assert.throws(() => requireProtectedRoute(route), /confirmation/i);
  }
});

test("an approved mapping cannot silently target an entirely inactive style library", async (t) => {
  const { registry } = await fixture(t, { contentStatus: "candidate" });
  await assert.rejects(() => loadApprovedStyleLibrary(registry), /mapping.*style|consumer/i);
});

test("unapproved mapping resources are ignored while approved foreign or missing targets fail", async (t) => {
  for (const mappingStatus of ["candidate", "deprecated"] as const) {
    const { registry } = await fixture(t, { mappingStatus });
    const selection = requireProtectedRoute(routeProtectedScenario(facts, await loadApprovedStyleLibrary(registry)));
    assert.ok(selection.candidates[0].evidence.every((item) => !item.startsWith("approved_mapping:")));
  }
  for (const options of [{ mappingStyle: "missing" }, { mappingCompany: "beta" }]) {
    const { registry } = await fixture(t, options);
    await assert.rejects(() => loadApprovedStyleLibrary(registry), /mapping.*(style|company)|foreign/i);
  }
});

test("protected library enforces mapping sharing and template generate purpose", async (t) => {
  for (const options of [{ noImport: true }, { noExport: true }, { templateGenerate: false }]) {
    const { registry } = await fixture(t, options);
    await assert.rejects(() => loadApprovedStyleLibrary(registry), /access denied|purpose/i);
  }
});

test("copied libraries, fabricated selections and bare template refs cannot prepare generation", async (t) => {
  const { registry } = await fixture(t);
  const library = await loadApprovedStyleLibrary(registry);
  const selection = requireProtectedRoute(routeProtectedScenario(facts, library));
  assert.throws(() => routeProtectedScenario(facts, { ...library }), /authentic|registered/i);
  for (const value of [{ ...selection }, { templateRefs: ["anything.potx"] }]) {
    assert.throws(() => requireProtectedRoute(value as ResolvedStyleSelection), /authentic|protected/i);
    await assert.rejects(() => prepareGenerationResources(value as ResolvedStyleSelection, registry, context), /authentic|protected/i);
  }
  const other = await fixture(t);
  await assert.rejects(() => prepareGenerationResources(selection, other.registry, context), /registry/i);
  await assert.rejects(() => prepareGenerationResources(selection, registry, { ...context, styleId: "technical" }), /style/i);
  await assert.rejects(() => prepareGenerationResources(selection, registry, { ...context, companyId: "beta" }), /company/i);
  await assert.rejects(() => prepareGenerationResources(selection, registry, { ...context, purpose: "qa" }), /purpose/i);
});

test("preparation rechecks bytes and page planning rejects substituted authentic handles", async (t) => {
  const setup = await fixture(t);
  const selection = requireProtectedRoute(routeProtectedScenario(facts, await loadApprovedStyleLibrary(setup.registry)));
  const resources = await prepareGenerationResources(selection, setup.registry, context);
  const another = await fixture(t);
  const foreignToken = await resolveResource(another.registry, another.token, context);
  const forged = { ...resources, tokens: [foreignToken] };
  assert.throws(() => requireGenerationResources(forged, selection), /authentic|bound/i);
  assert.throws(() => buildProtectedPagePlan(selection, forged, slides), /authentic|bound/i);
  await writeFile(join(setup.companyRoot, "resources/styles/annual/tokens.json"), "changed");
  await assert.rejects(() => prepareGenerationResources(selection, setup.registry, context), /hash/i);
});

test("page plans use company baseline then own tokens and only explicitly allowed request overrides", async (t) => {
  const { registry } = await fixture(t, {
    companyTokens: { titleColor: "ABCDEF" },
    tokenOverridePolicy: { allowedTokenKeys: ["titleColor", "bodyColor"], forbiddenTokenKeys: ["bodyColor"] },
  });
  const selection = requireProtectedRoute(routeProtectedScenario(facts, await loadApprovedStyleLibrary(registry)));
  const resources = await prepareGenerationResources(selection, registry, context);
  assert.equal(buildProtectedPagePlan(selection, resources, slides).tokens.titleColor, "112233");
  const plan = buildProtectedPagePlan(selection, resources, slides, { titleColor: "AABBCC" });
  assert.equal(plan.tokens.titleColor, "AABBCC");
  assert.equal(Object.isFrozen(plan.tokens), true);
  assert.equal(Object.isFrozen(plan.layouts[0].title), true);
  for (const overrides of [{ bodyColor: "AABBCC" }, { width: 20 }]) {
    assert.throws(() => buildProtectedPagePlan(selection, resources, slides, overrides), /override/i);
  }
});

test("conflicting token resources fail without an explicit field override policy", async (t) => {
  const { registry } = await fixture(t, { companyTokens: { titleColor: "ABCDEF" } });
  const selection = requireProtectedRoute(routeProtectedScenario(facts, await loadApprovedStyleLibrary(registry)));
  const resources = await prepareGenerationResources(selection, registry, context);
  assert.throws(() => buildProtectedPagePlan(selection, resources, slides), /override/i);
});
