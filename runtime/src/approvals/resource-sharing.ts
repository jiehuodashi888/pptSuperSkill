import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import Ajv from "ajv";

import { validateContract } from "../contracts/validate.js";
import { isAuthenticResourceRegistry, openResourceRegistry, resolveRegisteredResourcePath } from "../resources/registry.js";
import type { ResourcePurpose, ResourceRecord, ResourceRef, ResourceRegistry, StyleManifest } from "../resources/types.js";
import { readApprovalDecision, readCanonicalApprovalRequest } from "./files.js";

export interface ResourceShareRequest {
  readonly type: "resource-share";
  readonly status: "candidate";
  readonly request_id: string;
  readonly companyId: string;
  readonly targetScope: "company";
  readonly source: ResourceRef;
  readonly consumerStyleIds: readonly string[];
  readonly purposes: readonly ResourcePurpose[];
  /** Local consent record bound by the request hash, not a verified user identity. */
  readonly ownerConsent?: { readonly companyId: string; readonly styleId: string; readonly consented: true };
  readonly licenseNotes: string;
  readonly rollbackNotes: string;
  readonly proposed_by: string;
}

export type ResourceShareProposal = Omit<ResourceShareRequest, "type" | "status">;

const validateRequest = new Ajv.default({ strict: true }).compile(
  JSON.parse(readFileSync(new URL("../../schemas/resource-share-request.schema.json", import.meta.url), "utf8")),
);
const issued = new WeakSet<object>();

export function isResourceShareRequest(value: unknown): value is ResourceShareRequest {
  return value !== null && typeof value === "object" && "type" in value && value.type === "resource-share";
}

export function isIssuedResourceShareRequest(value: unknown): value is ResourceShareRequest {
  return typeof value === "object" && value !== null && issued.has(value);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function matches(a: ResourceRef, b: ResourceRef): boolean {
  return a.resourceId === b.resourceId && a.scope === b.scope && a.companyId === b.companyId
    && a.styleId === b.styleId && a.version === b.version && a.sha256 === b.sha256;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/** Shared by the file API: no local request may publish core or foreign resources. */
export function assertResourceShareRequest(value: unknown, companyId: string): asserts value is ResourceShareRequest {
  if (!validateRequest(value)) throw new Error("Invalid canonical company resource share request");
  const request = value as ResourceShareRequest;
  if (request.companyId !== companyId || request.source.companyId !== companyId) {
    throw new Error("Resource share belongs to a foreign company");
  }
  const reference = validateContract("style-manifest", {
    companyId, styleId: "validation", status: "approved", ownedResources: [], imports: [request.source],
  });
  if (!reference.ok) throw new Error("Invalid resource share source reference");
  if (request.ownerConsent && (request.source.scope !== "style"
    || request.ownerConsent.companyId !== companyId || request.ownerConsent.styleId !== request.source.styleId)) {
    throw new Error("Resource share owner consent does not match the source owner");
  }
}

function sourceRecord(registry: ResourceRegistry, request: ResourceShareRequest): ResourceRecord {
  assertResourceShareRequest(request, registry.companyId);
  const record = registry.companyCatalog.resources.find((item) => matches(item, request.source));
  if (!record) throw new Error("Exact resource share source is not registered");
  if (record.status !== "approved") throw new Error("Resource share source must be approved");
  // Bind the complete purpose set so widening or narrowing it requires new review.
  if (!sameSet(record.allowedPurposes, request.purposes)) throw new Error("Resource share purposes changed");
  if (record.scope === "style") {
    const owner = Object.hasOwn(registry.styleManifests, record.styleId!) ? registry.styleManifests[record.styleId!] : undefined;
    if (!owner || owner.status !== "approved" || !owner.ownedResources.some((ref) => matches(ref, record))) {
      throw new Error("Resource share source is absent from its approved owner manifest");
    }
  }
  for (const id of request.consumerStyleIds) {
    const consumer = Object.hasOwn(registry.styleManifests, id) ? registry.styleManifests[id] : undefined;
    if (!consumer || consumer.companyId !== request.companyId || consumer.status !== "approved" || id === record.styleId) {
      throw new Error("Resource share requires approved same-company consumer styles distinct from the owner");
    }
  }
  return record;
}

/** Issue a proposal only; callers persist it through canonical local request files.
 * Neither this function nor a decision mutates catalogs, imports, or core content.
 */
export function proposeResourceShare(registry: ResourceRegistry, proposal: ResourceShareProposal): ResourceShareRequest {
  if (!isAuthenticResourceRegistry(registry)) throw new Error("Authentic resource registry required");
  const request = structuredClone({ type: "resource-share", status: "candidate", ...proposal });
  assertResourceShareRequest(request, registry.companyId);
  sourceRecord(registry, request);
  freeze(request);
  issued.add(request);
  return request;
}

async function liveRegistry(registry: ResourceRegistry): Promise<ResourceRegistry> {
  if (!isAuthenticResourceRegistry(registry)) throw new Error("Authentic resource registry required");
  return openResourceRegistry(registry.store, { coreResourcesRoot: registry.coreResourcesRoot });
}

async function validateShare(registry: ResourceRegistry, requestId: string, proposedImport?: StyleManifest): Promise<ResourceShareRequest> {
  const request = await readCanonicalApprovalRequest(registry.store, requestId);
  if (!isResourceShareRequest(request)) throw new Error("A company resource share approval is required");
  const decision = await readApprovalDecision(registry.store, requestId, request);
  if (!decision || decision.decision.action !== "approve") throw new Error("Resource share must have an approved decision");
  const record = sourceRecord(registry, request);
  if (!record.exportPolicy || !sameSet(record.exportPolicy.consumerStyleIds, request.consumerStyleIds)) {
    throw new Error("Resource share export consumer set changed or was revoked");
  }
  for (const id of request.consumerStyleIds) {
    const consumer = proposedImport?.styleId === id ? proposedImport : registry.styleManifests[id];
    if (!consumer.imports.some((ref) => matches(ref, request.source))) throw new Error("Resource share requires an exact consumer import");
  }
  const bytes = await readFile(await resolveRegisteredResourcePath(registry, record));
  if (createHash("sha256").update(bytes).digest("hex") !== request.source.sha256) {
    throw new Error("Resource share source hash mismatch");
  }
  return freeze(request);
}

/** Re-read the canonical catalogs/manifests and decision on every validation.
 * This returns review data, never a resolver handle or permission to publish core.
 */
export async function validateApprovedResourceShare(registry: ResourceRegistry, requestId: string): Promise<ResourceShareRequest> {
  return validateShare(await liveRegistry(registry), requestId);
}

/** Validate imports before saving a manifest. Removals are always possible;
 * new core imports belong to the external core publication/configuration workflow.
 * This validates imports only and does not authorize ownership or other edits.
 */
export async function validateStyleImportChange(registry: ResourceRegistry, manifest: StyleManifest, approvalRequestIds: readonly string[]): Promise<void> {
  const proposed = structuredClone(manifest);
  const ids = [...approvalRequestIds];
  const live = await liveRegistry(registry);
  if (!validateContract("style-manifest", proposed).ok || proposed.companyId !== live.companyId) {
    throw new Error("Invalid company style import change");
  }
  const existing = Object.hasOwn(live.styleManifests, proposed.styleId) ? live.styleManifests[proposed.styleId] : undefined;
  if (!existing || proposed.status !== "approved") throw new Error("Style import change requires an approved consumer");
  for (const ref of proposed.imports) {
    if (ref.scope === "core") {
      if (!existing.imports.some((item) => matches(item, ref))) throw new Error("Local company sharing cannot add a core target");
      continue;
    }
    if (ref.companyId !== live.companyId) throw new Error("Style import change cannot cross company boundaries");
    let approved = false;
    for (const id of ids) {
      const request = await readCanonicalApprovalRequest(live.store, id);
      if (isResourceShareRequest(request) && matches(ref, request.source) && request.consumerStyleIds.includes(proposed.styleId)) {
        await validateShare(live, id, proposed);
        approved = true;
        break;
      }
    }
    if (!approved) throw new Error("Style import requires a matching company share approval");
  }
}
