import type { ApprovedScenarioMapping, StyleLibraryEntry } from "../routing/router.js";
import { isAuthenticResourceRegistry } from "./registry.js";
import { resolveResource } from "./resolver.js";
import type { ResourceRecord, ResourceRef, ResourceRegistry, StyleManifest } from "./types.js";

export interface RegisteredStyleResources {
  readonly templates: readonly ResourceRef[];
  readonly tokens: readonly ResourceRef[];
  readonly layouts: readonly ResourceRef[];
}

export interface RegisteredStyleEntry extends StyleLibraryEntry {
  readonly manifest: StyleManifest;
  readonly resources: RegisteredStyleResources;
}

/** Process-local library issued only after catalog and resource authorization. */
export interface ApprovedStyleLibrary {
  readonly companyId: string;
  readonly styles: readonly RegisteredStyleEntry[];
  readonly approvedMappings: readonly ApprovedScenarioMapping[];
}

const libraries = new WeakMap<object, ResourceRegistry>();

export function requireRegisteredStyleLibrary(library: ApprovedStyleLibrary): ResourceRegistry {
  const registry = library && libraries.get(library);
  if (!registry) throw new Error("Authentic registered style library required");
  return registry;
}

export function sameResourceRef(left: ResourceRef, right: ResourceRef): boolean {
  return left.resourceId === right.resourceId && left.scope === right.scope
    && left.companyId === right.companyId && left.styleId === right.styleId
    && left.version === right.version && left.sha256 === right.sha256;
}

function recordRef(record: ResourceRecord): ResourceRef {
  const { resourceId, scope, companyId, styleId, version, sha256 } = record;
  return Object.freeze({ resourceId, scope, ...(companyId ? { companyId } : {}), ...(styleId ? { styleId } : {}), version, sha256 });
}

/** No directory scanning, legacy asset paths or caller-supplied style definitions. */
export async function loadApprovedStyleLibrary(registry: ResourceRegistry): Promise<ApprovedStyleLibrary> {
  if (!isAuthenticResourceRegistry(registry)) throw new Error("Authentic resource registry required");
  const styles: RegisteredStyleEntry[] = [];
  for (const manifest of Object.values(registry.styleManifests)) {
    if (manifest.status !== "approved") continue;
    const context = { companyId: registry.companyId, styleId: manifest.styleId, purpose: "route" as const };
    const manifestRecord = registry.companyCatalog.resources.find((record) => record.kind === "style-manifest"
      && record.styleId === manifest.styleId && record.status === "approved")!;
    await resolveResource(registry, recordRef(manifestRecord), context);
    const templates: ResourceRef[] = [];
    const tokens: ResourceRef[] = [];
    const layouts: ResourceRef[] = [];
    for (const ref of [...manifest.ownedResources, ...manifest.imports]) {
      const catalog = ref.scope === "core" ? registry.coreCatalog : registry.companyCatalog;
      const record = catalog.resources.find((entry) => sameResourceRef(entry, ref));
      if (!record) throw new Error("Style resource reference is not registered");
      const group = record.kind === "template" ? templates : record.kind === "token-set" ? tokens : record.kind === "layout" ? layouts : undefined;
      if (!group) continue;
      if (!record.allowedPurposes.includes("generate")) throw new Error("Style resource generate purpose is not allowed");
      const handle = await resolveResource(registry, ref, context);
      if (!group.some((entry) => sameResourceRef(entry, handle.ref))) group.push(handle.ref);
    }
    styles.push(Object.freeze({
      ref: manifest.styleId, status: "approved", manifest,
      businessTypes: manifest.businessTypes ?? Object.freeze([]), audiences: manifest.audiences ?? Object.freeze([]),
      departments: manifest.departments ?? Object.freeze([]), deliveryContexts: manifest.deliveryContexts ?? Object.freeze([]), tags: manifest.tags ?? Object.freeze([]),
      // Scoring consumes the legacy shape, but protected selections never expose paths.
      templateRefs: Object.freeze([]),
      resources: Object.freeze({ templates: Object.freeze(templates), tokens: Object.freeze(tokens), layouts: Object.freeze(layouts) }),
    }));
  }

  const mappingRecords = registry.companyCatalog.resources.filter((record) => record.path === "scenarios/approved-mappings.json" && record.status === "approved");
  if (mappingRecords.length > 1) throw new Error("Multiple approved mapping resources are ambiguous");
  if (mappingRecords.length && !styles.length) throw new Error("Approved mapping has no approved consumer style");
  const approvedMappings: ApprovedScenarioMapping[] = [];
  if (mappingRecords.length) {
    const record = mappingRecords[0];
    if (record.kind !== "rule-set" || record.scope !== "company") throw new Error("Approved mappings must be a registered company rule-set");
    // Every participating style must explicitly import this company routing policy.
    let document: unknown;
    for (const style of styles) {
      const handle = await resolveResource(registry, recordRef(record), { companyId: registry.companyId, styleId: style.manifest.styleId, purpose: "route" });
      document = JSON.parse(Buffer.from(handle.bytes).toString("utf8"));
    }
    if (!isObject(document) || document.companyId !== registry.companyId || !Array.isArray(document.mappings)) {
      throw new Error("Invalid approved mapping company or document");
    }
    const ids = new Set<string>();
    for (const mapping of document.mappings) {
      if (!isObject(mapping)) throw new Error("Invalid scenario mapping");
      if (["candidate", "deprecated", "rejected"].includes(String(mapping.status))) continue;
      if (mapping.status !== "approved" || typeof mapping.mappingId !== "string" || !mapping.mappingId.trim() || ids.has(mapping.mappingId)) throw new Error("Invalid approved mapping identity or status");
      if ((mapping.companyId !== undefined && mapping.companyId !== registry.companyId)
        || typeof mapping.styleId !== "string" || !styles.some((style) => style.ref === mapping.styleId)) {
        throw new Error("Approved mapping references a foreign company or missing approved style");
      }
      for (const key of ["businessType", "audience", "department", "deliveryContext"] as const) {
        if (mapping[key] !== undefined && typeof mapping[key] !== "string") throw new Error("Invalid scenario mapping predicate");
      }
      if (mapping.tags !== undefined && (!Array.isArray(mapping.tags) || !mapping.tags.every((tag) => typeof tag === "string"))) throw new Error("Invalid scenario mapping tags");
      ids.add(mapping.mappingId);
      approvedMappings.push(Object.freeze({
        mappingId: mapping.mappingId, styleRef: mapping.styleId, status: "approved",
        businessType: mapping.businessType as string | undefined, audience: mapping.audience as string | undefined,
        department: mapping.department as string | undefined, deliveryContext: mapping.deliveryContext as string | undefined,
        tags: mapping.tags === undefined ? undefined : Object.freeze([...(mapping.tags as string[])]),
      }));
    }
  }
  const library = Object.freeze({ companyId: registry.companyId, styles: Object.freeze(styles), approvedMappings: Object.freeze(approvedMappings) });
  libraries.set(library, registry);
  return library;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
