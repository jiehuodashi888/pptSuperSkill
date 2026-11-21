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
  if (!(OBSERVER_IDS as readonly string[]).includes(observerId)) {
    throw new Error(`Unknown observer: ${observerId}`);
  }
  const isolatedInput = isolateInput(input);
  validateTaskInput(isolatedInput);

  return Object.freeze({
    observerId,
    promptReference: `${PROMPT_ROOT}/${observerId}.md`,
    input: isolatedInput,
  });
}

function validateTaskInput(input: ObservationInput): void {
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
}

function isolateInput(input: ObservationInput): ObservationInput {
  if (!isPlainObject(input)) {
    throw new Error("Observation input must be a plain object");
  }
  const descriptors = getDataDescriptors(input, "Observation input");
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !INPUT_FIELDS.has(key)) {
      throw new Error(`Observation input contains unsupported field: ${String(key)}`);
    }
  }

  const companyId = descriptorValue(descriptors, "companyId");
  const level = descriptorValue(descriptors, "level");
  const sourceIds = cloneJsonValue(
    descriptorValue(descriptors, "sourceIds"),
    "sourceIds",
  );
  const capabilities = descriptorValue(descriptors, "capabilities");
  const structuralFacts = descriptorValue(descriptors, "structuralFacts");
  const renderedAssets = descriptorValue(descriptors, "renderedAssets");
  const isolated: ObservationInput = {
    companyId: companyId as string,
    level: level as ObservationLevel,
    sourceIds: sourceIds as readonly string[],
    ...(capabilities === undefined
      ? {}
      : {
          capabilities: cloneJsonValue(
            capabilities,
            "capabilities",
          ) as CapabilityManifest,
        }),
    ...(structuralFacts === undefined
      ? {}
      : {
          structuralFacts: cloneJsonValue(structuralFacts, "structuralFacts"),
        }),
    ...(renderedAssets === undefined
      ? {}
      : {
          renderedAssets: cloneJsonValue(
            renderedAssets,
            "renderedAssets",
          ) as readonly string[],
        }),
  };

  return Object.freeze(isolated);
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
    return cloneJsonArray(value, path);
  }
  if (!isPlainObject(value)) {
    throw new Error(`${path} must contain only JSON values`);
  }

  const clone: Record<string, unknown> = {};
  const descriptors = getDataDescriptors(value, path);
  for (const key of Reflect.ownKeys(descriptors)) {
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
    clone[key] = cloneJsonValue(descriptors[key]!.value, `${path}.${key}`);
  }

  return Object.freeze(clone);
}

function cloneJsonArray(value: unknown[], path: string): readonly unknown[] {
  const descriptors = getDataDescriptors(value, path);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`${path} has an invalid array length`);
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === "length") {
      continue;
    }
    if (
      typeof key !== "string" ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= length
    ) {
      throw new Error(`${path} contains unsupported array field: ${String(key)}`);
    }
  }

  const clone: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) {
      throw new Error(`${path} must not contain sparse array entries`);
    }
    clone.push(cloneJsonValue(descriptor.value, `${path}[${index}]`));
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

function getDataDescriptors(
  value: object,
  path: string,
): Record<PropertyKey, PropertyDescriptor> {
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor)) {
      throw new Error(`${path}.${String(key)} must be a data field, not an accessor`);
    }
  }
  return descriptors;
}

function descriptorValue(
  descriptors: Record<PropertyKey, PropertyDescriptor>,
  key: string,
): unknown {
  return descriptors[key]?.value;
}
