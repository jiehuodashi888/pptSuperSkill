import {
  candidateConfidence,
  MINIMUM_ROUTE_CONFIDENCE,
  MINIMUM_ROUTE_SCORE,
  MINIMUM_SCORE_LEAD,
  scoreStyle,
} from "./scoring.js";

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

  return Object.freeze({
    styleRefs: Object.freeze([...decision.selectedStyleRefs]),
    templateRefs: Object.freeze([...decision.templateRefs]),
    confidence: decision.confidence,
    evidence: Object.freeze([
      ...(decision.candidates.find(
        (candidate) => candidate.styleRef === decision.selectedStyleRefs[0],
      )?.evidence ?? []),
    ]),
  });
}

function freezeRequest(request: GenerationRequest): GenerationRequest {
  return Object.freeze({
    ...request,
    explicitTags: request.explicitTags
      ? Object.freeze([...request.explicitTags])
      : undefined,
  });
}
