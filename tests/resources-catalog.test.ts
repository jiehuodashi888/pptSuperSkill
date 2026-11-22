import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateContract } from "../runtime/src/contracts/validate.js";
import { openInstance } from "../runtime/src/instances/store.js";
import { openResourceRegistry } from "../runtime/src/resources/registry.js";

const sha256 = "a".repeat(64);

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
        sha256,
        path: "styles/annual-report/manifest.json",
        status: "approved",
        allowedPurposes: ["route", "generate", "qa"],
      },
      approvedStyleRecord,
    ])),
  );
  await writeFile(
    join(companyRoot, "styles", "annual-report", "manifest.json"),
    JSON.stringify({
      styleId: "annual-report",
      companyId: "acme",
      status: "approved",
      ownedResources: [
        {
          resourceId: "annual-template-v2",
          scope: "style",
          companyId: "acme",
          styleId: "annual-report",
          version: "2.0.0",
          sha256,
        },
      ],
      imports: [],
    }),
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
  });
  const coreRoot = join(root, "core");
  await mkdir(join(companyRoot, "styles", "annual-report"), { recursive: true });
  await mkdir(coreRoot);
  await writeFile(
    join(companyRoot, "resources", "catalog.json"),
    JSON.stringify(catalog([{
      resourceId: "annual-report-manifest",
      kind: "style-manifest",
      scope: "style",
      companyId: "acme",
      styleId: "annual-report",
      version: "1.0.0",
      sha256,
      path: "styles/annual-report/manifest.json",
      status: "approved",
      allowedPurposes: ["route"],
    }])),
  );
  await writeFile(
    join(companyRoot, "styles", "annual-report", "manifest.json"),
    JSON.stringify({
      styleId: "annual-report",
      companyId: "acme",
      status: "approved",
      ownedResources: [],
      imports: [{
        resourceId: "foreign-brand",
        scope: "company",
        companyId: "beta",
        version: "1.0.0",
        sha256,
      }],
    }),
  );
  await writeFile(join(coreRoot, "core-catalog.json"), JSON.stringify(catalog([])));

  const store = await openInstance(root, "acme");
  await assert.rejects(() => openResourceRegistry(store, { coreResourcesRoot: coreRoot }), /foreign company/i);
});
