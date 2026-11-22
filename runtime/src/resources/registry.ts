import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { validateContract } from "../contracts/validate.js";
import type { InstanceStore } from "../instances/store.js";
import type {
  ResourceCatalog,
  ResourceRef,
  ResourceRegistry,
  RuntimeDeploymentConfig,
  StyleManifest,
} from "./types.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

async function readJson(path: string, description: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot load ${description} at ${path}`, { cause: error });
  }
}

function requireCatalog(value: unknown, description: string): ResourceCatalog {
  const validation = validateContract("resource-catalog", value);
  if (!validation.ok) {
    throw new Error(`Invalid ${description}: ${validation.errors.join("; ")}`);
  }
  return value as ResourceCatalog;
}

function requireManifest(value: unknown, description: string): StyleManifest {
  const validation = validateContract("style-manifest", value);
  if (!validation.ok) {
    throw new Error(`Invalid ${description}: ${validation.errors.join("; ")}`);
  }
  return value as StyleManifest;
}

function assertCatalogOwnership(catalog: ResourceCatalog, companyId: string): void {
  for (const record of catalog.resources) {
    if (record.scope === "core" || record.companyId !== companyId) {
      throw new Error(`Instance catalog record ${record.resourceId} belongs outside company ${companyId}`);
    }
  }
}

function assertCoreCatalog(catalog: ResourceCatalog): void {
  for (const record of catalog.resources) {
    if (record.scope !== "core") {
      throw new Error(`Core catalog record ${record.resourceId} must use core scope`);
    }
  }
}

function assertManifestReferenceCompany(ref: ResourceRef, companyId: string, styleId: string): void {
  if (ref.scope !== "core" && ref.companyId !== companyId) {
    throw new Error(`Style manifest ${styleId} imports a foreign company resource`);
  }
}

async function loadStyleManifests(store: InstanceStore, catalog: ResourceCatalog): Promise<Readonly<Record<string, StyleManifest>>> {
  const manifests: Record<string, StyleManifest> = {};
  const manifestRecords = catalog.resources.filter((record) => record.kind === "style-manifest");

  for (const record of manifestRecords) {
    if (record.scope !== "style" || record.companyId !== store.companyId || !record.styleId || record.status !== "approved") {
      throw new Error("Style manifest catalog records must be approved style resources owned by the current company");
    }
    if (Object.hasOwn(manifests, record.styleId)) {
      throw new Error(`Multiple approved style manifest records exist for ${store.companyId}/${record.styleId}`);
    }

    const manifest = requireManifest(
      await readJson(store.resolve(record.path), `style manifest ${record.styleId}`),
      `style manifest ${record.styleId}`,
    );
    if (manifest.companyId !== store.companyId || manifest.styleId !== record.styleId) {
      throw new Error(`Style manifest ${record.styleId} does not match its cataloged company/style identity`);
    }
    for (const ref of [...manifest.ownedResources, ...manifest.imports]) {
      assertManifestReferenceCompany(ref, store.companyId, record.styleId);
    }
    manifests[record.styleId] = freeze(manifest);
  }

  return freeze(manifests);
}

export async function openResourceRegistry(
  store: InstanceStore,
  config: Pick<RuntimeDeploymentConfig, "coreResourcesRoot">,
): Promise<ResourceRegistry> {
  const companyCatalog = requireCatalog(
    await readJson(store.resolve("resources/catalog.json"), "instance resource catalog"),
    "instance resource catalog",
  );
  assertCatalogOwnership(companyCatalog, store.companyId);

  const coreResourcesRoot = await realpath(config.coreResourcesRoot);
  const coreCatalog = requireCatalog(
    await readJson(join(coreResourcesRoot, "core-catalog.json"), "core resource catalog"),
    "core resource catalog",
  );
  assertCoreCatalog(coreCatalog);

  const frozenCompanyCatalog = freeze(companyCatalog);
  const frozenCoreCatalog = freeze(coreCatalog);
  const styleManifests = await loadStyleManifests(store, frozenCompanyCatalog);

  return Object.freeze({
    store,
    companyId: store.companyId,
    instanceRoot: store.root,
    coreResourcesRoot,
    companyCatalog: frozenCompanyCatalog,
    coreCatalog: frozenCoreCatalog,
    styleManifests,
  });
}
