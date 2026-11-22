import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { validateContract } from "../contracts/validate.js";
import { isAuthenticResourceRegistry, resolveRegisteredResourcePath } from "./registry.js";
import type { ResourcePurpose, ResourceRecord, ResourceRef, ResourceRegistry } from "./types.js";

export interface ResourceAccessContext {
  readonly companyId: string;
  readonly styleId?: string;
  readonly requestId?: string;
  readonly purpose: ResourcePurpose;
}

export interface ResolvedResource {
  readonly ref: ResourceRef;
  readonly path: string;
  /** A defensive copy: callers cannot alter the verified bytes held by this handle. */
  readonly bytes: Uint8Array;
  readonly access: ResourceAccessContext;
}

const handles = new WeakSet<object>();
const formalPurposes: readonly ResourcePurpose[] = ["route", "generate", "qa"];
const purposes: readonly ResourcePurpose[] = ["observe", "route", "generate", "qa", "review"];
const identifier = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

export function isAuthenticResolvedResource(value: unknown): value is ResolvedResource {
  return typeof value === "object" && value !== null && handles.has(value);
}

function matches(left: ResourceRef, right: ResourceRef): boolean {
  return left.resourceId === right.resourceId && left.scope === right.scope
    && left.companyId === right.companyId && left.styleId === right.styleId
    && left.version === right.version && left.sha256 === right.sha256;
}

function validateReference(ref: ResourceRef): void {
  // Reuse the canonical reference schema rather than a second, divergent validator.
  const result = validateContract("style-manifest", {
    companyId: "validation", styleId: "validation", status: "approved", ownedResources: [], imports: [ref],
  });
  if (!result.ok) throw new Error(`Invalid resource reference: ${result.errors.join("; ")}`);
}

function authorize(registry: ResourceRegistry, record: ResourceRecord, context: ResourceAccessContext): void {
  if (record.scope === "request" || record.scope === "quarantine") {
    throw new Error(`Resource scope ${record.scope} is unavailable in phase 1/2`);
  }
  if (!record.allowedPurposes.includes(context.purpose)) throw new Error("Resource purpose is not allowed");
  if (formalPurposes.includes(context.purpose) && record.status !== "approved") {
    throw new Error("Resource must be approved for this purpose");
  }

  // Core resources can serve framework operations without a style; styles pin imports.
  if (record.scope === "core" && context.styleId === undefined) return;
  const consumer = context.styleId && Object.hasOwn(registry.styleManifests, context.styleId)
    ? registry.styleManifests[context.styleId] : undefined;
  if (!consumer || (formalPurposes.includes(context.purpose) && consumer.status !== "approved")) {
    throw new Error("Resource access denied: a valid consumer style is required");
  }
  if (record.scope === "style" && record.styleId === consumer.styleId) {
    // The cataloged manifest itself defines ownership and need not list itself.
    if (record.kind === "style-manifest" || consumer.ownedResources.some((owned) => matches(owned, record))) return;
    throw new Error("Resource access denied: resource is absent from style ownership");
  }
  const imported = consumer.imports.some((ref) => matches(ref, record));
  if (imported && (record.scope === "core"
    || record.exportPolicy?.consumerStyleIds.includes(consumer.styleId))) return;
  throw new Error("Resource access denied: matching export and import are required");
}

export async function resolveResource(
  registry: ResourceRegistry,
  ref: ResourceRef,
  context: ResourceAccessContext,
): Promise<ResolvedResource> {
  if (!isAuthenticResourceRegistry(registry)) throw new Error("Authentic resource registry required");
  validateReference(ref);
  const refSnapshot = Object.freeze({ ...ref });
  const access = Object.freeze({ ...context });
  if (typeof access.companyId !== "string" || !identifier.test(access.companyId)
    || (access.styleId !== undefined && (typeof access.styleId !== "string" || !identifier.test(access.styleId)))
    || (access.requestId !== undefined && (typeof access.requestId !== "string" || access.requestId.length === 0))
    || !purposes.includes(access.purpose)) {
    throw new Error("Invalid resource access context");
  }
  if (access.companyId !== registry.companyId
    || (refSnapshot.scope !== "core" && refSnapshot.companyId !== access.companyId)) {
    throw new Error("Resource company does not match the current company");
  }
  const catalog = refSnapshot.scope === "core" ? registry.coreCatalog : registry.companyCatalog;
  const record = catalog.resources.find((entry) => matches(entry, refSnapshot));
  if (!record) throw new Error("Exact resource reference is not registered");
  authorize(registry, record, access);
  const path = await resolveRegisteredResourcePath(registry, record);
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
    throw new Error(`Resource ${record.resourceId} hash mismatch`);
  }
  const handle: ResolvedResource = Object.freeze({
    ref: refSnapshot, path, get bytes() { return Uint8Array.from(bytes); }, access,
  });
  handles.add(handle);
  return handle;
}
