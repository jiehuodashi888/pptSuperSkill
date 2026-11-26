import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateContract } from "../runtime/src/contracts/validate.js";
import { openInstance } from "../runtime/src/instances/store.js";
import { openResourceRegistry } from "../runtime/src/resources/registry.js";
import { validateInstance } from "../runtime/src/instances/validate.js";
import type { ResourceRecord, ResourceRef, StyleManifest } from "../runtime/src/resources/types.js";

const sha256 = "a".repeat(64);

const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
function ref(record: ResourceRecord): ResourceRef {
  const { resourceId, scope, companyId, styleId, version, sha256 } = record;
  return { resourceId, scope, companyId, ...(styleId ? { styleId } : {}), version, sha256 };
}

async function validationFixture(t: test.TestContext) {
  const { companyRoot } = await createInstance(t, {
    company_id: "acme", core_version: "0.1.0", assets: [],
    resource_catalog: "resources/catalog.json", resource_catalog_version: "1.0.0",
  });
  await mkdir(join(companyRoot, "styles/default"), { recursive: true });
  await mkdir(join(companyRoot, "scenarios"));
  const policyBytes = '{"example":true}';
  const mapping = { companyId: "acme", mappings: [{ mappingId: "generic-report", styleId: "default", status: "approved", businessType: "report" }] };
  const policy: ResourceRecord = { resourceId: "default-policy", kind: "qa-policy", scope: "style", companyId: "acme", styleId: "default", version: "1.0.0", sha256: digest(policyBytes), path: "styles/default/policy.json", status: "approved", allowedPurposes: ["qa"] };
  const mappings: ResourceRecord = { resourceId: "scenario-mappings", kind: "rule-set", scope: "company", companyId: "acme", version: "1.0.0", sha256: digest(JSON.stringify(mapping)), path: "scenarios/approved-mappings.json", status: "approved", allowedPurposes: ["route"], exportPolicy: { mode: "allow-listed", consumerStyleIds: ["default"] } };
  const manifest: StyleManifest = { companyId: "acme", styleId: "default", status: "approved", ownedResources: [ref(policy)], imports: [ref(mappings)] };
  const manifestRecord: ResourceRecord = { resourceId: "default-manifest", kind: "style-manifest", scope: "style", companyId: "acme", styleId: "default", version: "1.0.0", sha256: digest(JSON.stringify(manifest)), path: "styles/default/manifest.json", status: "approved", allowedPurposes: ["route"] };
  await writeFile(join(companyRoot, policy.path), policyBytes);
  await writeFile(join(companyRoot, mappings.path), JSON.stringify(mapping));
  await writeFile(join(companyRoot, manifestRecord.path), JSON.stringify(manifest));
  const records = [policy, mappings, manifestRecord];
  async function saveCatalog() {
    await writeFile(join(companyRoot, "resources/catalog.json"), JSON.stringify(catalog(records)));
  }
  async function saveManifest(value: StyleManifest) {
    const bytes = JSON.stringify(value);
    records[2] = { ...manifestRecord, sha256: digest(bytes) };
    await writeFile(join(companyRoot, manifestRecord.path), bytes);
    await saveCatalog();
  }
  await saveCatalog();
  return { companyRoot, records, manifest, mapping, saveCatalog, saveManifest };
}

test("opt-in validation accepts exact registered resources without upgrading legacy assets into resources", async (t) => {
  const fixture = await validationFixture(t);
  await writeFile(join(fixture.companyRoot, "legacy-only.json"), "legacy contents");
  const manifestPath = join(fixture.companyRoot, "instance.yaml");
  const instance = JSON.parse(await readFile(manifestPath, "utf8"));
  instance.assets = ["legacy-only.json"];
  await writeFile(manifestPath, JSON.stringify(instance));
  assert.equal((await validateInstance(fixture.companyRoot)).resourceCatalog, "validated");
});

test("opt-in validation rejects an existing resource path absent from its catalog", async (t) => {
  const fixture = await validationFixture(t);
  fixture.records.splice(0, 1);
  await fixture.saveCatalog();
  await assert.rejects(validateInstance(fixture.companyRoot), /not registered|undeclared/i);
});

test("opt-in validation rejects a style resource without a declared style manifest", async (t) => {
  const fixture = await validationFixture(t);
  fixture.records.pop();
  await fixture.saveCatalog();
  await assert.rejects(validateInstance(fixture.companyRoot), /manifest/i);
});

test("opt-in validation rejects an absent manifest file", async (t) => {
  const fixture = await validationFixture(t);
  await unlink(join(fixture.companyRoot, "styles/default/manifest.json"));
  await assert.rejects(validateInstance(fixture.companyRoot), /ENOENT|manifest/i);
});

for (const identity of [{ companyId: "other" }, { styleId: "other" }]) {
  test(`opt-in validation rejects manifest identity mismatch: ${Object.keys(identity)[0]}`, async (t) => {
    const fixture = await validationFixture(t);
    await fixture.saveManifest({ ...fixture.manifest, ...identity });
    await assert.rejects(validateInstance(fixture.companyRoot), /identity|company|style/i);
  });
}

test("opt-in validation rejects catalog ownership outside the company", async (t) => {
  const fixture = await validationFixture(t);
  fixture.records[0] = { ...fixture.records[0], companyId: "other" };
  await fixture.saveCatalog();
  await assert.rejects(validateInstance(fixture.companyRoot), /company/i);
});

test("opt-in validation rejects a company resource misrepresented as style ownership", async (t) => {
  const fixture = await validationFixture(t);
  await fixture.saveManifest({ ...fixture.manifest, ownedResources: [ref(fixture.records[1])] });
  await assert.rejects(validateInstance(fixture.companyRoot), /ownership|owned/i);
});

test("opt-in validation rejects a missing declared mapping resource", async (t) => {
  const fixture = await validationFixture(t);
  fixture.records.splice(1, 1);
  await fixture.saveCatalog();
  await assert.rejects(validateInstance(fixture.companyRoot), /registered|mapping/i);
});

test("opt-in validation rejects a mapping for an absent approved style", async (t) => {
  const fixture = await validationFixture(t);
  fixture.mapping.mappings[0].styleId = "absent";
  const bytes = JSON.stringify(fixture.mapping);
  fixture.records[1] = { ...fixture.records[1], sha256: digest(bytes) };
  await writeFile(join(fixture.companyRoot, fixture.records[1].path), bytes);
  await fixture.saveManifest({ ...fixture.manifest, imports: [ref(fixture.records[1])] });
  await assert.rejects(validateInstance(fixture.companyRoot), /mapping|approved style/i);
});

test("opt-in validation hashes non-routing resources and rejects content drift", async (t) => {
  const fixture = await validationFixture(t);
  await writeFile(join(fixture.companyRoot, "styles/default/policy.json"), '{"changed":true}');
  await assert.rejects(validateInstance(fixture.companyRoot), /hash mismatch/i);
});

test("opt-in validation rejects a catalog version different from the declared version", async (t) => {
  const fixture = await validationFixture(t);
  await writeFile(join(fixture.companyRoot, "resources/catalog.json"), JSON.stringify({ catalogVersion: "2.0.0", resources: fixture.records }));
  await assert.rejects(validateInstance(fixture.companyRoot), /version/i);
});

test("migrated example validates pinned bytes and provides a registered default route", async () => {
  const companyRoot = resolve("instances/example-company");
  assert.equal((await validateInstance(companyRoot)).resourceCatalog, "validated");
  const registry = await openResourceRegistry(await openInstance(resolve("instances"), "example-company"), { coreResourcesRoot: resolve("runtime/core-resources") });
  assert.equal(registry.styleManifests.default.status, "approved");
  const { loadApprovedStyleLibrary } = await import("../runtime/src/resources/style-library.js");
  const library = await loadApprovedStyleLibrary(registry);
  assert.equal(library.approvedMappings[0].styleRef, "default");
  assert.ok(library.styles[0].resources.tokens.length > 0);
  assert.ok(library.styles[0].resources.layouts.length > 0);
});

test("example pinned resources retain LF bytes under Git checkout attributes", async () => {
  const example = resolve("instances/example-company");
  const paths = ["resources/catalog.json", "styles/default/manifest.json", "styles/default/tokens.json", "styles/default/layouts.json", "scenarios/approved-mappings.json"];
  const attributes = spawnSync("git", ["check-attr", "eol", "--", ...paths], { cwd: example, encoding: "utf8" });
  assert.equal(attributes.status, 0, attributes.stderr);
  assert.equal(attributes.stdout.trim().split(/\r?\n/).length, paths.length);
  for (const line of attributes.stdout.trim().split(/\r?\n/)) assert.match(line, /: eol: lf$/);
  for (const path of paths) assert.equal((await readFile(join(example, path), "utf8")).includes("\r"), false, path);
});

const approvedCompanyRecord = {
  resourceId: "brand-baseline-v1",
  kind: "token-set",
  scope: "company",
  companyId: "acme",
  version: "1.0.0",
  sha256,
  path: "resources/company/brand-baseline-v1.json",
  status: "approved",
  allowedPurposes: ["route", "generate", "qa"],
};

const approvedStyleRecord = {
  resourceId: "annual-template-v2",
  kind: "template",
  scope: "style",
  companyId: "acme",
  styleId: "annual-report",
  version: "2.0.0",
  sha256,
  path: "resources/styles/annual-report/annual-template-v2.potx",
  status: "approved",
  allowedPurposes: ["generate"],
};

function catalog(resources: unknown[]) {
  return { catalogVersion: "1.0.0", resources };
}

test("resource catalog accepts approved company and style records", () => {
  assert.deepEqual(
    validateContract("resource-catalog", catalog([approvedCompanyRecord, approvedStyleRecord])),
    { ok: true, errors: [] },
  );
});

test("resource catalog rejects unknown scopes and purposes", () => {
  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, scope: "global" }])).ok,
    false,
  );
  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, allowedPurposes: ["publish"] }])).ok,
    false,
  );
});

test("resource catalog requires company and style ownership fields", () => {
  const { companyId: _companyId, ...companyWithoutOwner } = approvedCompanyRecord;
  const { styleId: _styleId, ...styleWithoutOwner } = approvedStyleRecord;

  assert.equal(validateContract("resource-catalog", catalog([companyWithoutOwner])).ok, false);
  assert.equal(validateContract("resource-catalog", catalog([styleWithoutOwner])).ok, false);
});

test("resource catalog rejects invalid immutable identities and unsafe paths", () => {
  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, version: "version-one" }])).ok,
    false,
  );
  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, sha256: "ABC123" }])).ok,
    false,
  );
  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, path: "/etc/passwd" }])).ok,
    false,
  );
  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, path: "resources/../secret.json" }])).ok,
    false,
  );
});

test("resource contracts accept numeric prereleases and reject leading-zero prerelease identifiers", () => {
  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, version: "1.0.0-1" }])).ok,
    true,
  );
  assert.equal(
    validateContract("style-manifest", {
      styleId: "annual-report",
      companyId: "acme",
      status: "approved",
      ownedResources: [],
      imports: [{
        resourceId: "brand-baseline-v1",
        scope: "company",
        companyId: "acme",
        version: "1.0.0-alpha.1",
        sha256,
      }],
    }).ok,
    true,
  );
  assert.equal(
    validateContract("instance", {
      company_id: "acme",
      core_version: "0.1.0",
      assets: [],
      resource_catalog_version: "1.0.0-1",
    }).ok,
    true,
  );

  assert.equal(
    validateContract("resource-catalog", catalog([{ ...approvedCompanyRecord, version: "1.0.0-01" }])).ok,
    false,
  );
  assert.equal(
    validateContract("style-manifest", {
      styleId: "annual-report",
      companyId: "acme",
      status: "approved",
      ownedResources: [],
      imports: [{
        resourceId: "brand-baseline-v1",
        scope: "company",
        companyId: "acme",
        version: "1.0.0-alpha.01",
        sha256,
      }],
    }).ok,
    false,
  );
  assert.equal(
    validateContract("instance", {
      company_id: "acme",
      core_version: "0.1.0",
      assets: [],
      resource_catalog_version: "1.0.0-alpha..beta",
    }).ok,
    false,
  );
});

test("resource catalog rejects duplicate full resource identities", () => {
  assert.equal(
    validateContract("resource-catalog", catalog([approvedCompanyRecord, { ...approvedCompanyRecord }])).ok,
    false,
  );
});

async function createInstance(t: test.TestContext, manifest: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "resource-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const companyRoot = join(root, "acme");
  await mkdir(join(companyRoot, "resources"), { recursive: true });
  await writeFile(join(companyRoot, "instance.yaml"), JSON.stringify(manifest));
  return { root, companyRoot };
}

test("resource registry loads frozen instance and fixed-core catalogs", async (t) => {
  const { root, companyRoot } = await createInstance(t, {
    company_id: "acme",
    core_version: "0.1.0",
    assets: [],
    resource_catalog: "resources/catalog.json",
    resource_catalog_version: "1.0.0",
  });
  const coreRoot = join(root, "core");
  await mkdir(join(companyRoot, "styles", "annual-report"), { recursive: true });
  await mkdir(coreRoot);
  const manifestBytes = JSON.stringify({
    styleId: "annual-report", companyId: "acme", status: "approved",
    ownedResources: [{
      resourceId: "annual-template-v2", scope: "style", companyId: "acme",
      styleId: "annual-report", version: "2.0.0", sha256,
    }],
    imports: [],
  });
  await writeFile(
    join(companyRoot, "resources", "catalog.json"),
    JSON.stringify(catalog([
      {
        resourceId: "annual-report-manifest",
        kind: "style-manifest",
        scope: "style",
        companyId: "acme",
        styleId: "annual-report",
        version: "1.0.0",
        sha256: createHash("sha256").update(manifestBytes).digest("hex"),
        path: "styles/annual-report/manifest.json",
        status: "approved",
        allowedPurposes: ["route", "generate", "qa"],
      },
      approvedStyleRecord,
    ])),
  );
  await writeFile(
    join(companyRoot, "styles", "annual-report", "manifest.json"),
    manifestBytes,
  );
  await writeFile(join(coreRoot, "core-catalog.json"), JSON.stringify(catalog([])));

  const registry = await openResourceRegistry(await openInstance(root, "acme"), {
    coreResourcesRoot: coreRoot,
  });

  assert.equal(registry.companyCatalog.resources.length, 2);
  assert.equal(registry.coreCatalog.resources.length, 0);
  assert.equal(registry.styleManifests["annual-report"]?.companyId, "acme");
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.companyCatalog.resources), true);
});

test("resource registry rejects a style manifest importing another company resource", async (t) => {
  const { root, companyRoot } = await createInstance(t, {
    company_id: "acme",
    core_version: "0.1.0",
    assets: [],
    resource_catalog: "resources/catalog.json",
    resource_catalog_version: "1.0.0",
  });
  const coreRoot = join(root, "core");
  await mkdir(join(companyRoot, "styles", "annual-report"), { recursive: true });
  await mkdir(coreRoot);
  const manifestBytes = JSON.stringify({
    styleId: "annual-report", companyId: "acme", status: "approved", ownedResources: [],
    imports: [{ resourceId: "foreign-brand", scope: "company", companyId: "beta", version: "1.0.0", sha256 }],
  });
  await writeFile(
    join(companyRoot, "resources", "catalog.json"),
    JSON.stringify(catalog([{
      resourceId: "annual-report-manifest",
      kind: "style-manifest",
      scope: "style",
      companyId: "acme",
      styleId: "annual-report",
      version: "1.0.0",
      sha256: createHash("sha256").update(manifestBytes).digest("hex"),
      path: "styles/annual-report/manifest.json",
      status: "approved",
      allowedPurposes: ["route"],
    }])),
  );
  await writeFile(
    join(companyRoot, "styles", "annual-report", "manifest.json"),
    manifestBytes,
  );
  await writeFile(join(coreRoot, "core-catalog.json"), JSON.stringify(catalog([])));

  const store = await openInstance(root, "acme");
  await assert.rejects(() => openResourceRegistry(store, { coreResourcesRoot: coreRoot }), /foreign company/i);
});
