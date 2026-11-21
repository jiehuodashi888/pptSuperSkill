import type { CapabilityManifest } from "../contracts/types.js";
import { validateContract } from "../contracts/validate.js";

export const OBSERVER_IDS = [
  "style-classifier",
  "typography",
  "visual-style",
  "layout",
  "master-template",
  "table",
  "chart",
  "visual-asset",
  "content",
] as const;

export type ObserverId = (typeof OBSERVER_IDS)[number];
export type ObservationLevel = "slide" | "deck" | "corpus";

export interface ObservationInput {
  readonly companyId: string;
  readonly level: ObservationLevel;
  readonly sourceIds: readonly string[];
  readonly capabilities?: CapabilityManifest;
  readonly structuralFacts?: unknown;
  readonly renderedAssets?: readonly string[];
}

export interface AgentTask {
  readonly observerId: ObserverId;
  readonly promptReference: string;
  readonly input: ObservationInput;
}

const PROMPT_ROOT =
  ".cursor/skills/enterprise-ppt-multistyle/references/observers";
const INPUT_FIELDS = new Set([
  "companyId",
  "level",
  "sourceIds",
  "capabilities",
  "structuralFacts",
  "renderedAssets",
]);
const FORBIDDEN_NESTED_FIELD_PARTS = [
  "provider",
  "model",
  "run",
  "adapter",
  "orchestration",
] as const;

export function createObservationTask(
  observerId: ObserverId,
  input: ObservationInput,
): AgentTask {
  validateTaskInput(observerId, input);
  const isolatedInput = isolateInput(input);

  return Object.freeze({
    observerId,
    promptReference: `${PROMPT_ROOT}/${observerId}.md`,
    input: isolatedInput,
  });
}

function validateTaskInput(
  observerId: ObserverId,
  input: ObservationInput,
): void {
  if (!(OBSERVER_IDS as readonly string[]).includes(observerId)) {
    throw new Error(`Unknown observer: ${observerId}`);
  }
  if (!isPlainObject(input)) {
    throw new Error("Observation input must be a plain object");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !INPUT_FIELDS.has(key)) {
      throw new Error(`Observation input contains unsupported field: ${String(key)}`);
    }
  }
  if (typeof input.companyId !== "string" || input.companyId.trim() === "") {
    throw new Error("Observation input requires a non-empty companyId");
  }
  if (
    !Array.isArray(input.sourceIds) ||
    input.sourceIds.length === 0 ||
    input.sourceIds.some(
      (sourceId) => typeof sourceId !== "string" || sourceId.trim() === "",
    )
  ) {
    throw new Error("Observation input requires non-empty sourceIds");
  }
  if (!["slide", "deck", "corpus"].includes(input.level)) {
    throw new Error(`Unsupported observation level: ${input.level}`);
  }
  if (
    input.renderedAssets !== undefined &&
    (!Array.isArray(input.renderedAssets) ||
      input.renderedAssets.some(
        (asset) => typeof asset !== "string" || asset.trim() === "",
      ))
  ) {
    throw new Error("Observation input renderedAssets must be non-empty strings");
  }
  if (
    input.capabilities !== undefined &&
    !validateContract("capability-manifest", input.capabilities).ok
  ) {
    throw new Error("Observation input contains an invalid capability manifest");
  }
  if (input.structuralFacts !== undefined) {
    validateJsonValue(input.structuralFacts, "structuralFacts");
  }
}

function isolateInput(input: ObservationInput): ObservationInput {
  const isolated: ObservationInput = {
    companyId: input.companyId,
    level: input.level,
    sourceIds: Object.freeze([...input.sourceIds]),
    ...(input.capabilities === undefined
      ? {}
      : { capabilities: cloneCapabilities(input.capabilities) }),
    ...(input.structuralFacts === undefined
      ? {}
      : {
          structuralFacts: cloneJsonValue(
            input.structuralFacts,
            "structuralFacts",
          ),
        }),
    ...(input.renderedAssets === undefined
      ? {}
      : { renderedAssets: Object.freeze([...input.renderedAssets]) }),
  };

  return Object.freeze(isolated);
}

function cloneCapabilities(
  capabilities: CapabilityManifest,
): CapabilityManifest {
  return Object.freeze({
    pptxRead: capabilities.pptxRead,
    pptxWrite: capabilities.pptxWrite,
    renderSlides: capabilities.renderSlides,
    imageAnalysis: capabilities.imageAnalysis,
    parallelAgents: capabilities.parallelAgents,
  });
}

function validateJsonValue(value: unknown, path: string): void {
  cloneJsonValue(value, path);
}

function cloneJsonValue(value: unknown, path: string): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (typeof value === "function") {
    throw new Error(`${path} must not contain a function`);
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`)),
    );
  }
  if (!isPlainObject(value)) {
    throw new Error(`${path} must contain only JSON values`);
  }

  const clone: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`${path} must not contain symbol fields`);
    }
    const keyParts = key
      .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean);
    const prohibited = FORBIDDEN_NESTED_FIELD_PARTS.find((part) =>
      keyParts.includes(part),
    );
    if (prohibited !== undefined) {
      throw new Error(`${path}.${key} contains prohibited ${prohibited} data`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`${path}.${key} must be a data field`);
    }
    clone[key] = cloneJsonValue(descriptor.value, `${path}.${key}`);
  }

  return Object.freeze(clone);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
