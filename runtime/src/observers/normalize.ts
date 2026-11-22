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
  let metadata = degradationMetadata(context);

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
    ...(result.property === undefined ? {} : { property: result.property }),
    evidence: result.evidence,
    confidence: result.confidence,
    agent_id: context.observerId,
    coverage: result.coverage === undefined ? metadata.coverage : result.coverage,
    missing_capabilities: result.missing_capabilities === undefined ? metadata.missing_capabilities : result.missing_capabilities,
    unknown_fields: result.unknown_fields === undefined ? metadata.unknown_fields : result.unknown_fields,
  };
  const validation = validateContract("observation", candidate);
  const errors = [...categoryErrors, ...validation.errors];

  if (errors.length > 0) {
    return { ok: false, ...metadata, errors };
  }

  const validated = candidate as Observation;
  metadata = {
    coverage: Math.min(metadata.coverage, validated.coverage),
    missing_capabilities: [...new Set([...metadata.missing_capabilities, ...validated.missing_capabilities])],
    unknown_fields: [...new Set([...metadata.unknown_fields, ...validated.unknown_fields])],
  };
  const observation = { ...validated, ...metadata };
  const mergedValidation = validateContract("observation", observation);
  if (!mergedValidation.ok) return { ok: false, ...metadata, errors: mergedValidation.errors };

  return {
    ok: true,
    observation,
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
