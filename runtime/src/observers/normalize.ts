import { types } from "node:util";

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

  let uncertainty: Record<string, unknown>;
  try {
    uncertainty = snapshotUncertainty(result);
  } catch (error) {
    return { ok: false, ...metadata, errors: [error instanceof Error ? error.message : String(error)] };
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
    coverage: uncertainty.coverage === undefined ? metadata.coverage : uncertainty.coverage,
    missing_capabilities: uncertainty.missing_capabilities === undefined ? metadata.missing_capabilities : uncertainty.missing_capabilities,
    unknown_fields: uncertainty.unknown_fields === undefined ? metadata.unknown_fields : uncertainty.unknown_fields,
  };
  const validation = validateContract("observation", candidate);
  const errors = categoryErrors;
  for (let index = 0; index < validation.errors.length; index++) {
    errors[errors.length] = validation.errors[index]!;
  }

  if (errors.length > 0) {
    return { ok: false, ...metadata, errors };
  }

  const validated = candidate as Observation;
  metadata = {
    coverage: Math.min(metadata.coverage, validated.coverage),
    missing_capabilities: unionByIndex(metadata.missing_capabilities, validated.missing_capabilities),
    unknown_fields: unionByIndex(metadata.unknown_fields, validated.unknown_fields),
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

/** Inputs are bounded validated snapshots; no inherited iterator is consumed. */
function unionByIndex<T extends string>(first: readonly T[], second: readonly T[]): T[] {
  const union: T[] = [];
  const seen = new Set<T>();
  for (let index = 0; index < first.length + second.length; index++) {
    const value = index < first.length ? first[index]! : second[index - first.length]!;
    if (!seen.has(value)) {
      seen.add(value);
      union[union.length] = value;
    }
  }
  return union;
}

/** Read own data descriptors once; never validate an array then consume its iterator. */
function snapshotUncertainty(result: Record<string, unknown>): Record<string, unknown> {
  if (types.isProxy(result) || ![Object.prototype, null].includes(Object.getPrototypeOf(result))) {
    throw new TypeError("Observer uncertainty requires plain data objects");
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const field of ["coverage", "unknown_fields", "missing_capabilities"]) {
    const descriptor = Object.getOwnPropertyDescriptor(result, field);
    if (descriptor === undefined) continue;
    if (!("value" in descriptor)) throw new TypeError(`${field} must be a data field, not an accessor`);
    const value: unknown = descriptor.value;
    snapshot[field] = value === undefined || field === "coverage"
      ? value
      : snapshotUncertaintyArray(value, field, field === "unknown_fields" ? 128 : 5);
  }
  return Object.freeze(snapshot);
}

function snapshotUncertaintyArray(value: unknown, field: string, maxItems: number): string[] {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${field} must be a plain data array`);
  }
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maxItems) {
    throw new TypeError(`${field} must have at most ${maxItems} entries`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
      throw new TypeError(`${field} must not contain custom array behavior`);
    }
  }
  const snapshot: string[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new TypeError(`${field} entries must be own string data fields`);
    }
    snapshot[index] = descriptor.value;
  }
  Object.freeze(snapshot);
  return snapshot;
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
  return typeof value === "object" && value !== null && !types.isProxy(value) && !Array.isArray(value);
}
