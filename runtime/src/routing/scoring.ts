import type {
  ApprovedScenarioMapping,
  GenerationRequest,
  RoutingCandidate,
  StyleLibraryEntry,
} from "./router.js";

const FACT_WEIGHTS = {
  businessType: 4,
  audience: 3,
  department: 2,
  deliveryContext: 2,
  tag: 1,
  approvedMapping: 5,
} as const;

export const MINIMUM_ROUTE_SCORE = 4;
export const MINIMUM_ROUTE_CONFIDENCE = 0.6;
export const MINIMUM_SCORE_LEAD = 2;

export interface ScoredCandidate extends RoutingCandidate {
  readonly possibleScore: number;
}

export function scoreStyle(
  request: GenerationRequest,
  style: StyleLibraryEntry,
  mappings: readonly ApprovedScenarioMapping[],
): ScoredCandidate {
  let score = 0;
  let possibleScore = 0;
  const evidence: string[] = [];

  scoreFact(
    request.businessType,
    style.businessTypes,
    FACT_WEIGHTS.businessType,
    "business_type",
  );
  scoreFact(request.audience, style.audiences, FACT_WEIGHTS.audience, "audience");
  scoreFact(
    request.department,
    style.departments,
    FACT_WEIGHTS.department,
    "department",
  );
  scoreFact(
    request.deliveryContext,
    style.deliveryContexts,
    FACT_WEIGHTS.deliveryContext,
    "delivery_context",
  );

  for (const tag of uniqueNormalized(request.explicitTags ?? [])) {
    possibleScore += FACT_WEIGHTS.tag;
    if (includesNormalized(style.tags, tag)) {
      score += FACT_WEIGHTS.tag;
      evidence.push(`tag:${tag}`);
    }
  }

  for (const mapping of mappings) {
    if (
      mapping.status === "approved" &&
      mapping.styleRef === style.ref &&
      mappingMatches(mapping, request)
    ) {
      score += FACT_WEIGHTS.approvedMapping;
      possibleScore += FACT_WEIGHTS.approvedMapping;
      evidence.push(`approved_mapping:${mapping.mappingId}`);
    }
  }

  return {
    styleRef: style.ref,
    score,
    evidence,
    possibleScore,
  };

  function scoreFact(
    fact: string | undefined,
    approvedValues: readonly string[],
    weight: number,
    evidenceName: string,
  ): void {
    const normalizedFact = normalize(fact);
    if (!normalizedFact) return;

    possibleScore += weight;
    if (includesNormalized(approvedValues, normalizedFact)) {
      score += weight;
      evidence.push(`${evidenceName}:${normalizedFact}`);
    }
  }
}

export function candidateConfidence(candidate: ScoredCandidate): number {
  if (candidate.score === 0 || candidate.possibleScore === 0) return 0;

  const fit = candidate.score / candidate.possibleScore;
  const evidenceSufficiency = Math.min(
    1,
    candidate.score / MINIMUM_ROUTE_SCORE,
  );
  return round(fit * evidenceSufficiency);
}

function mappingMatches(
  mapping: ApprovedScenarioMapping,
  request: GenerationRequest,
): boolean {
  return (
    matchesRequired(mapping.businessType, request.businessType) &&
    matchesRequired(mapping.audience, request.audience) &&
    matchesRequired(mapping.department, request.department) &&
    matchesRequired(mapping.deliveryContext, request.deliveryContext) &&
    (mapping.tags ?? []).every((tag) =>
      includesNormalized(request.explicitTags ?? [], tag),
    )
  );
}

function matchesRequired(
  expected: string | undefined,
  actual: string | undefined,
): boolean {
  const normalizedExpected = normalize(expected);
  return !normalizedExpected || normalizedExpected === normalize(actual);
}

function includesNormalized(values: readonly string[], expected: string): boolean {
  const normalizedExpected = normalize(expected);
  return values.some((value) => normalize(value) === normalizedExpected);
}

function uniqueNormalized(values: readonly string[]): string[] {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
