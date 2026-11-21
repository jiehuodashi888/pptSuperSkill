import type {
  CapabilityName,
  Observation,
} from "../contracts/types.js";
import { validateContract } from "../contracts/validate.js";
import type { ObserverId } from "./catalog.js";

export interface ObservationContext {
  readonly observerId: ObserverId;
  readonly coverage: number;
  readonly missingCapabilities: readonly CapabilityName[];
  readonly unknownFields: readonly string[];
}

interface DegradationMetadata {
  readonly coverage: number;
  readonly missing_capabilities: CapabilityName[];
  readonly unknown_fields: string[];
}

export type ObservationNormalizationResult =
  | (DegradationMetadata & {
      readonly ok: true;
      readonly observation: Observation;
      readonly errors: [];
    })
  | (DegradationMetadata & {
      readonly ok: false;
      readonly errors: string[];
    });

export function normalizeObservation(
  result: unknown,
  context: ObservationContext,
): ObservationNormalizationResult {
  const metadata = degradationMetadata(context);

  if (!isRecord(result)) {
    return {
      ok: false,
      ...metadata,
      errors: ["Observer result must be an object"],
    };
  }

  const categoryErrors =
    result.category === context.observerId
      ? []
      : [`category must match observer ${context.observerId}`];
  const candidate = {
    observation_id: result.observation_id,
    category: result.category,
    fact: result.fact,
    evidence: result.evidence,
    confidence: result.confidence,
    agent_id: context.observerId,
    ...metadata,
  };
  const validation = validateContract("observation", candidate);
  const errors = [...categoryErrors, ...validation.errors];

  if (errors.length > 0) {
    return { ok: false, ...metadata, errors };
  }

  return {
    ok: true,
    observation: candidate as Observation,
    ...metadata,
    errors: [],
  };
}

function degradationMetadata(
  context: ObservationContext,
): DegradationMetadata {
  return {
    coverage: context.coverage,
    missing_capabilities: [...context.missingCapabilities],
    unknown_fields: [...context.unknownFields],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
