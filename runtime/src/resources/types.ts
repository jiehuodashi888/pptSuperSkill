import type { InstanceStore } from "../instances/store.js";

export type ResourceScope = "core" | "company" | "style" | "request" | "quarantine";

export type ResourceKind =
  | "template"
  | "token-set"
  | "layout"
  | "asset"
  | "rule-set"
  | "evidence-index"
  | "font-license"
  | "qa-policy"
  | "style-manifest";

export type ResourcePurpose = "observe" | "route" | "generate" | "qa" | "review";

export type ResourceStatus = "candidate" | "approved" | "deprecated" | "rejected";

export interface ResourceRef {
  readonly resourceId: string;
  readonly scope: ResourceScope;
  readonly companyId?: string;
  readonly styleId?: string;
  readonly version: string;
  readonly sha256: string;
}

export interface ResourceRecord extends ResourceRef {
  readonly kind: ResourceKind;
  readonly path: string;
  readonly status: ResourceStatus;
  readonly allowedPurposes: readonly ResourcePurpose[];
  readonly exportPolicy?: {
    readonly mode: "allow-listed";
    readonly consumerStyleIds: readonly string[];
  };
}

export interface ResourceCatalog {
  readonly catalogVersion: string;
  readonly resources: readonly ResourceRecord[];
}

export interface StyleManifest {
  readonly styleId: string;
  readonly companyId: string;
  readonly status: ResourceStatus;
  readonly ownedResources: readonly ResourceRef[];
  readonly imports: readonly ResourceRef[];
  readonly businessTypes?: readonly string[];
  readonly audiences?: readonly string[];
  readonly departments?: readonly string[];
  readonly deliveryContexts?: readonly string[];
  readonly tags?: readonly string[];
  readonly tokenOverridePolicy?: {
    readonly allowedTokenKeys: readonly string[];
    readonly forbiddenTokenKeys: readonly string[];
  };
}

export interface RuntimeDeploymentConfig {
  readonly instancesRoot: string;
  readonly coreResourcesRoot: string;
  readonly outputRoot: string;
  readonly cacheRoot: string;
}

export interface ResourceRegistry {
  readonly store: InstanceStore;
  readonly companyId: string;
  readonly instanceRoot: string;
  readonly coreResourcesRoot: string;
  readonly companyCatalog: ResourceCatalog;
  readonly coreCatalog: ResourceCatalog;
  readonly styleManifests: Readonly<Record<string, StyleManifest>>;
}
