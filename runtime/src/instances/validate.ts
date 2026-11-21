import { basename, dirname, resolve } from "node:path";
import { openInstance } from "./store.js";

/** Validate the package boundary and declared assets, not semantic style readiness. */
export async function validateInstance(directory: string) {
  if (!directory?.trim()) throw new Error("An instance directory is required");
  const absolute = resolve(directory);
  const store = await openInstance(dirname(absolute), basename(absolute));
  for (const asset of store.manifest.assets) store.resolve(asset);
  return { valid: true, companyId: store.companyId, coreVersion: store.manifest.core_version, declaredAssets: store.manifest.assets.length, scope: "manifest-and-declared-asset-containment" };
}
