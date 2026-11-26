import {
  candidateConfidence,
  MINIMUM_ROUTE_CONFIDENCE,
  MINIMUM_ROUTE_SCORE,
  MINIMUM_SCORE_LEAD,
  scoreStyle,
} from "./scoring.js";
import { requireRegisteredStyleLibrary, type ApprovedStyleLibrary, type RegisteredStyleResources } from "../resources/style-library.js";
import type { ResourceRegistry, StyleManifest } from "../resources/types.js";

export interface GenerationRequest {
  readonly businessType?: string;
  readonly audience?: string;
  readonly department?: string;
  readonly deliveryContext?: string;
  readonly explicitTags?: readonly string[];
}

export interface StyleLibraryEntry {
  readonly ref: string;
  readonly status: "approved" | "candidate" | "deprecated" | "rejected";
  readonly businessTypes: readonly string[];
  readonly audiences: readonly string[];
  readonly departments: readonly string[];
  readonly deliveryContexts: readonly string[];
  readonly tags: readonly string[];
  readonly templateRefs: readonly string[];
}

export interface ApprovedScenarioMapping {
  readonly mappingId: string;
  readonly styleRef: string;
  readonly businessType?: string;
  readonly audience?: string;
  readonly department?: string;
  readonly deliveryContext?: string;
  readonly tags?: readonly string[];
  readonly status: "approved";
}

/** Low-level/test-only library. Never accept this at a production boundary. */
export interface StyleLibrary {
  readonly styles: readonly StyleLibraryEntry[];
  readonly approvedMappings: readonly ApprovedScenarioMapping[];
}

export interface RoutingCandidate {
  readonly styleRef: string;
  readonly score: number;
  readonly evidence: readonly string[];
}

export interface RoutingDecision {
  readonly requestFacts: GenerationRequest;
  readonly candidates: readonly RoutingCandidate[];
  readonly selectedStyleRefs: readonly string[];
  readonly templateRefs: readonly string[];
  readonly confidence: number;
  readonly requires_confirmation: boolean;
}

export interface ApprovedRoute {
  readonly styleRefs: readonly string[];
  readonly templateRefs: readonly string[];
  readonly confidence: number;
  readonly evidence: readonly string[];
}

const issuedDecisions = new WeakSet<object>();
const issuedApprovedRoutes = new WeakSet<object>();

/** Low-level/test-only scoring entry point; use protected routing for production. */
export function routeScenario(
  request: GenerationRequest,
  library: StyleLibrary,
): RoutingDecision {
  const approvedStyles = library.styles.filter(
    (style) => style.status === "approved",
  );
  const approvedStyleRefs = new Set(approvedStyles.map((style) => style.ref));
  const approvedMappings = library.approvedMappings.filter(
    (mapping) =>
      mapping.status === "approved" && approvedStyleRefs.has(mapping.styleRef),
  );
  const scored = approvedStyles
    .map((style) => scoreStyle(request, style, approvedMappings))
    .sort(
      (left, right) =>
        right.score - left.score || left.styleRef.localeCompare(right.styleRef),
    );

  const best = scored[0];
  const runnerUp = scored[1];
  const confidence = best ? candidateConfidence(best) : 0;
  const scoreLead = best ? best.score - (runnerUp?.score ?? 0) : 0;
  const requiresConfirmation =
    !best ||
    best.score < MINIMUM_ROUTE_SCORE ||
    confidence < MINIMUM_ROUTE_CONFIDENCE ||
    (runnerUp !== undefined && scoreLead < MINIMUM_SCORE_LEAD);
  const selectedStyle = requiresConfirmation
    ? undefined
    : approvedStyles.find((style) => style.ref === best.styleRef);

  const decision: RoutingDecision = Object.freeze({
    requestFacts: freezeRequest(request),
    candidates: Object.freeze(
      scored.map((candidate) =>
        Object.freeze({
          styleRef: candidate.styleRef,
          score: candidate.score,
          evidence: Object.freeze([...candidate.evidence]),
        }),
      ),
    ),
    selectedStyleRefs: Object.freeze(selectedStyle ? [selectedStyle.ref] : []),
    templateRefs: Object.freeze(
      selectedStyle ? [...selectedStyle.templateRefs] : [],
    ),
    confidence,
    requires_confirmation: requiresConfirmation,
  });
  issuedDecisions.add(decision);
  return decision;
}

export function requireApprovedRoute(decision: RoutingDecision): ApprovedRoute {
  if (!issuedDecisions.has(decision)) {
    throw new Error("Generation requires an issued routing decision");
  }
  if (decision.requires_confirmation || decision.selectedStyleRefs.length === 0) {
    throw new Error("Route requires confirmation before generation");
  }

  const approvedRoute: ApprovedRoute = Object.freeze({
    styleRefs: Object.freeze([...decision.selectedStyleRefs]),
    templateRefs: Object.freeze([...decision.templateRefs]),
    confidence: decision.confidence,
    evidence: Object.freeze([
      ...(decision.candidates.find(
        (candidate) => candidate.styleRef === decision.selectedStyleRefs[0],
      )?.evidence ?? []),
    ]),
  });
  issuedApprovedRoutes.add(approvedRoute);
  return approvedRoute;
}

/** Approval handles are process-local; persisted routes must be routed again. */
export function isAuthenticApprovedRoute(value: unknown): value is ApprovedRoute {
  return typeof value === "object" && value !== null && issuedApprovedRoutes.has(value);
}

function freezeRequest(request: GenerationRequest): GenerationRequest {
  return Object.freeze({
    ...request,
    explicitTags: request.explicitTags
      ? Object.freeze([...request.explicitTags])
      : undefined,
  });
}

export interface ResolvedStyleSelection {
  readonly companyId: string;
  readonly styleId?: string;
  readonly requestFacts: GenerationRequest;
  readonly candidates: readonly RoutingCandidate[];
  readonly confidence: number;
  readonly requires_confirmation: boolean;
  readonly resources: RegisteredStyleResources;
  readonly tokenOverridePolicy?: StyleManifest["tokenOverridePolicy"];
}

const protectedSelections = new WeakMap<object, ResourceRegistry>();

export function routeProtectedScenario(request: GenerationRequest, library: ApprovedStyleLibrary): ResolvedStyleSelection {
  const registry = requireRegisteredStyleLibrary(library);
  const decision = routeScenario(request, library);
  const selected = library.styles.find((style) => style.ref === decision.selectedStyleRefs[0]);
  const selection: ResolvedStyleSelection = Object.freeze({
    companyId: library.companyId, styleId: selected?.manifest.styleId,
    requestFacts: decision.requestFacts, candidates: decision.candidates, confidence: decision.confidence,
    requires_confirmation: decision.requires_confirmation,
    resources: selected?.resources ?? Object.freeze({ templates: Object.freeze([]), tokens: Object.freeze([]), layouts: Object.freeze([]) }),
    tokenOverridePolicy: selected?.manifest.tokenOverridePolicy,
  });
  protectedSelections.set(selection, registry);
  return selection;
}

/** Optional registry binding prevents reuse against a different approval snapshot. */
export function requireProtectedRoute(selection: ResolvedStyleSelection, registry?: ResourceRegistry): ResolvedStyleSelection & { readonly styleId: string } {
  const issuer = selection && protectedSelections.get(selection);
  if (!issuer) throw new Error("Authentic protected route selection required");
  if (registry !== undefined && issuer !== registry) throw new Error("Protected route belongs to another registry");
  if (selection.requires_confirmation || !selection.styleId) throw new Error("Route requires confirmation before generation");
  return selection as ResolvedStyleSelection & { readonly styleId: string };
}
