import { realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ResourceCatalog, ResourceRecord } from "../resources/types.js";

import {
  loadInstanceManifest,
  type InstanceManifest,
} from "./manifest.js";

export type InstanceAssetRef = string;

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) &&
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`))
  );
}

/**
 * Provides defense-in-depth filesystem scoping for one local company instance.
 * This path validation is not an OS security boundary: deployments that require
 * hard isolation must also use filesystem ACLs, separate roots, or separate OS
 * identities so the process itself cannot read another company's data.
 */
export class InstanceStore {
  constructor(
    readonly companyId: string,
    readonly root: string,
    readonly manifest: InstanceManifest,
  ) {}

  /** The resource resolver passes only an exact record from its validated catalog. */
  resolveRegisteredResource(record: ResourceRecord, catalog: ResourceCatalog): string {
    if (!catalog.resources.includes(record) || record.scope === "core" || record.companyId !== this.companyId) {
      throw new Error("Resource is not registered in this company catalog");
    }
    return this.resolve(record.path);
  }

  resolve(assetRef: InstanceAssetRef): string {
    if (typeof assetRef !== "string" || assetRef.length === 0) {
      throw new Error("Instance asset reference must be a non-empty string");
    }

    const separatorIndex = assetRef.indexOf(":");
    let localRef = assetRef;
    if (separatorIndex >= 0) {
      const referenceCompanyId = assetRef.slice(0, separatorIndex);
      if (referenceCompanyId !== this.companyId) {
        throw new Error(`Cross-instance reference rejected: ${assetRef}`);
      }
      localRef = assetRef.slice(separatorIndex + 1);
    }

    if (
      localRef.length === 0 ||
      localRef.includes("\\") ||
      localRef.includes("\0") ||
      localRef.startsWith("/") ||
      localRef.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`Unsafe instance asset reference: ${assetRef}`);
    }

    const lexicalTarget = resolve(this.root, ...localRef.split("/"));
    if (!isWithin(this.root, lexicalTarget)) {
      throw new Error(`Instance asset reference escapes its root: ${assetRef}`);
    }

    const canonicalTarget = realpathSync.native(lexicalTarget);
    if (!isWithin(this.root, canonicalTarget)) {
      throw new Error(`Instance asset reference escapes its canonical root: ${assetRef}`);
    }

    return canonicalTarget;
  }
}

export async function openInstance(
  root: string,
  companyId: string,
): Promise<InstanceStore> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(companyId)) {
    throw new Error(`Invalid company id: ${companyId}`);
  }

  const canonicalRoot = await realpath(resolve(root));
  const lexicalCompanyRoot = resolve(canonicalRoot, companyId);
  if (!isWithin(canonicalRoot, lexicalCompanyRoot)) {
    throw new Error(`Company instance escapes the configured root: ${companyId}`);
  }

  const canonicalCompanyRoot = await realpath(lexicalCompanyRoot);
  if (
    !isWithin(canonicalRoot, canonicalCompanyRoot) ||
    relative(canonicalRoot, canonicalCompanyRoot) !== companyId
  ) {
    throw new Error(`Company instance does not match its canonical root: ${companyId}`);
  }

  const manifest = await loadInstanceManifest(canonicalCompanyRoot);
  if (manifest.company_id !== companyId) {
    throw new Error(
      `Instance manifest belongs to ${manifest.company_id}, not ${companyId}`,
    );
  }

  return new InstanceStore(companyId, canonicalCompanyRoot, manifest);
}
