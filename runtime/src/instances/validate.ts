import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openInstance } from "./store.js";
import { openResourceRegistry, resolveRegisteredResourcePath } from "../resources/registry.js";
import { resolveResource } from "../resources/resolver.js";
import { loadApprovedStyleLibrary, sameResourceRef } from "../resources/style-library.js";
import type { ResourceRef } from "../resources/types.js";

/** Legacy assets prove containment only. Explicit catalog opt-in also validates
 * registered bytes, ownership, imports and protected routing semantics. This is
 * package validation, not a claim of rendering or enterprise QA coverage. */
export async function validateInstance(directory: string) {
  if (!directory?.trim()) throw new Error("An instance directory is required");
  const absolute = resolve(directory);
  const store = await openInstance(dirname(absolute), basename(absolute));
  for (const asset of store.manifest.assets) store.resolve(asset);
  const result = { valid: true, companyId: store.companyId, coreVersion: store.manifest.core_version, declaredAssets: store.manifest.assets.length };
  if (!store.manifest.resource_catalog) {
    return { ...result, resourceCatalog: "legacy" as const, scope: "manifest-and-declared-asset-containment" };
  }

  const registry = await openResourceRegistry(store, {
    coreResourcesRoot: fileURLToPath(new URL("../../core-resources/", import.meta.url)),
  });
  for (const record of registry.companyCatalog.resources) {
    const bytes = await readFile(await resolveRegisteredResourcePath(registry, record));
    if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
      throw new Error(`Resource ${record.resourceId} hash mismatch`);
    }
    if (record.scope === "style" && record.status === "approved") {
      const manifest = registry.styleManifests[record.styleId!];
      if (!manifest || manifest.status !== "approved") {
        throw new Error(`Approved resource ${record.resourceId} requires an approved style manifest`);
      }
      if (record.kind !== "style-manifest" && !manifest.ownedResources.some((ref) => sameResourceRef(ref, record))) {
        throw new Error(`Resource ${record.resourceId} is absent from style ownership`);
      }
    }
  }
  for (const manifest of Object.values(registry.styleManifests)) {
    for (const ref of manifest.ownedResources) {
      if (ref.scope !== "style" || ref.companyId !== manifest.companyId || ref.styleId !== manifest.styleId) {
        throw new Error(`Style ${manifest.styleId} has mismatched owned resource identity`);
      }
    }
    for (const ref of [...manifest.ownedResources, ...manifest.imports]) {
      await validateReference(ref, manifest.styleId);
    }
  }
  await loadApprovedStyleLibrary(registry);
  return { ...result, resourceCatalog: "validated" as const, scope: "resource-catalog-and-declared-asset-containment" };

  async function validateReference(ref: ResourceRef, styleId: string) {
    const catalog = ref.scope === "core" ? registry.coreCatalog : registry.companyCatalog;
    const record = catalog.resources.find((entry) => sameResourceRef(entry, ref));
    if (!record) throw new Error(`Style ${styleId} resource ${ref.resourceId} is not registered`);
    for (const purpose of record.allowedPurposes) {
      await resolveResource(registry, ref, { companyId: store.companyId, styleId, purpose });
    }
  }
}
