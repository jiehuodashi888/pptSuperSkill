import type {
  CapabilityManifest,
  Evidence,
  Observation,
  Rule,
} from "../contracts/types.js";
import { validateContract } from "../contracts/validate.js";
import {
  OBSERVER_IDS,
  createObservationTask,
  type AgentTask,
  type ObservationInput,
  type ObservationLevel,
  type ObserverId,
} from "../observers/catalog.js";
import { normalizeObservation } from "../observers/normalize.js";
import type { ModelAdapter } from "./model-adapter.js";

const DEFAULT_PARALLELISM = 4;
const MAX_PARALLELISM = 4;

export interface ObservationRequest {
  readonly companyId: string;
  readonly level: ObservationLevel;
  readonly sourceIds: readonly string[];
  readonly capabilities: CapabilityManifest;
  readonly structuralFacts?: unknown;
  readonly renderedAssets?: readonly string[];
  readonly maxConcurrency?: number;
}

export interface RuleProposal {
  readonly rule: Rule;
  readonly confidence: number;
}

export interface ClassificationProposal {
  readonly classificationId: string;
  readonly taxonomy: "business_type" | "visual_style" | "layout_pattern";
  readonly label: string;
  readonly confidence: number;
  readonly status: "candidate" | "approved" | "deprecated" | "rejected";
  readonly evidence: readonly Evidence[];
}

interface ObservationResultBase {
  readonly observerId: ObserverId;
  readonly observations: readonly Observation[];
  readonly rules: readonly RuleProposal[];
  readonly classifications: readonly ClassificationProposal[];
}

export type ObserverRunResult =
  | (ObservationResultBase & { readonly ok: true })
  | (ObservationResultBase & {
      readonly ok: false;
      readonly errors: readonly string[];
    });

export interface ObservationRun {
  readonly companyId: string;
  readonly level: ObservationLevel;
  readonly sourceIds: readonly string[];
  readonly executionMode: "serial" | "parallel";
  readonly results: readonly ObserverRunResult[];
}

export async function observeDeck(
  request: ObservationRequest,
  adapter: ModelAdapter,
): Promise<ObservationRun> {
  const concurrency = requestedConcurrency(request);
  const executionMode = request.capabilities.parallelAgents
    ? "parallel"
    : "serial";
  const tasks = createTasks(request);
  const execute = (task: AgentTask) => executeTask(task, adapter);
  const results = executionMode === "parallel"
    ? await mapBounded(tasks, concurrency, execute)
    : await mapSerial(tasks, execute);

  return Object.freeze({
    companyId: request.companyId,
    level: request.level,
    sourceIds: Object.freeze([...request.sourceIds]),
    executionMode,
    results: Object.freeze(results),
  });
}

function createTasks(request: ObservationRequest): AgentTask[] {
  const input: ObservationInput = {
    companyId: request.companyId,
    level: request.level,
    sourceIds: request.sourceIds,
    capabilities: request.capabilities,
    ...(request.structuralFacts === undefined
      ? {}
      : { structuralFacts: request.structuralFacts }),
    ...(request.renderedAssets === undefined
      ? {}
      : { renderedAssets: request.renderedAssets }),
  };
  return OBSERVER_IDS.map((observerId) => createObservationTask(observerId, input));
}

function requestedConcurrency(request: ObservationRequest): number {
  const requested = request.maxConcurrency ?? DEFAULT_PARALLELISM;
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error("maxConcurrency must be a positive integer");
  }
  return Math.min(requested, MAX_PARALLELISM, OBSERVER_IDS.length);
}

async function executeTask(
  task: AgentTask,
  adapter: ModelAdapter,
): Promise<ObserverRunResult> {
  try {
    const raw = await adapter.run(task);
    return normalizeOutput(task, raw);
  } catch (error) {
    return failedResult(task.observerId, [errorMessage(error)]);
  }
}

function normalizeOutput(task: AgentTask, raw: unknown): ObserverRunResult {
  const envelope = outputEnvelope(raw);
  const context = normalizationContext(task);
  const normalized = envelope.observations.map((observation) =>
    normalizeObservation(observation, context)
  );
  const observations = normalized.flatMap((result) =>
    result.ok ? [result.observation] : []
  );
  const errors = normalized.flatMap((result) => result.ok ? [] : result.errors);
  errors.push(...envelope.errors);

  if (errors.length > 0) {
    return {
      observerId: task.observerId,
      ok: false,
      observations,
      rules: envelope.rules,
      classifications: envelope.classifications,
      errors,
    };
  }
  return {
    observerId: task.observerId,
    ok: true,
    observations,
    rules: envelope.rules,
    classifications: envelope.classifications,
  };
}

function normalizationContext(task: AgentTask) {
  const capabilities = task.input.capabilities!;
  const checked = ["pptxRead", "renderSlides", "imageAnalysis"] as const;
  const missingCapabilities = checked.filter((name) => !capabilities[name]);
  const unknownFields = [
    ...(!capabilities.pptxRead ? ["pptx_structure"] : []),
    ...(!capabilities.renderSlides ? ["rendered_appearance"] : []),
    ...(!capabilities.imageAnalysis ? ["visual_analysis"] : []),
  ];
  return {
    observerId: task.observerId,
    coverage: (checked.length - missingCapabilities.length) / checked.length,
    missingCapabilities,
    unknownFields,
  };
}

interface OutputEnvelope {
  observations: unknown[];
  rules: RuleProposal[];
  classifications: ClassificationProposal[];
  errors: string[];
}

function outputEnvelope(raw: unknown): OutputEnvelope {
  if (!isRecord(raw) || !("observations" in raw)) {
    return { observations: [raw], rules: [], classifications: [], errors: [] };
  }
  const observations = Array.isArray(raw.observations) ? raw.observations : [];
  const errors = Array.isArray(raw.observations)
    ? []
    : ["Observer output observations must be an array"];
  if (Array.isArray(raw.observations) && raw.observations.length === 0) {
    errors.push("Observer output must contain an evidence-backed observation");
  }
  const rules = Array.isArray(raw.rules)
    ? raw.rules.filter(isRuleProposal)
    : [];
  const classifications = Array.isArray(raw.classifications)
    ? raw.classifications.filter(isClassificationProposal)
    : [];
  if (Array.isArray(raw.rules) && rules.length !== raw.rules.length) {
    errors.push("Observer output contains an invalid rule proposal");
  }
  if (
    Array.isArray(raw.classifications) &&
    classifications.length !== raw.classifications.length
  ) {
    errors.push("Observer output contains an invalid classification proposal");
  }
  return { observations, rules, classifications, errors };
}

function isRuleProposal(value: unknown): value is RuleProposal {
  return isRecord(value) && isRecord(value.rule) &&
    validateContract("rule", value.rule).ok &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) && value.confidence >= 0 &&
    value.confidence <= 1;
}

function isClassificationProposal(value: unknown): value is ClassificationProposal {
  return isRecord(value) &&
    typeof value.classificationId === "string" && value.classificationId !== "" &&
    ["business_type", "visual_style", "layout_pattern"].includes(
      String(value.taxonomy),
    ) &&
    typeof value.label === "string" && value.label !== "" &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) && value.confidence >= 0 &&
    value.confidence <= 1 &&
    ["candidate", "approved", "deprecated", "rejected"].includes(
      String(value.status),
    ) && Array.isArray(value.evidence) && value.evidence.every(isEvidence);
}

function isEvidence(value: unknown): value is Evidence {
  return isRecord(value) &&
    typeof value.source_id === "string" && value.source_id !== "" &&
    Number.isInteger(value.slide_number) && Number(value.slide_number) >= 1 &&
    typeof value.element_ref === "string" && value.element_ref !== "" &&
    typeof value.source_type === "string" && value.source_type !== "" &&
    typeof value.locator === "string" && value.locator !== "";
}

function failedResult(observerId: ObserverId, errors: string[]): ObserverRunResult {
  return {
    observerId,
    ok: false,
    observations: [],
    rules: [],
    classifications: [],
    errors,
  };
}

async function mapSerial<T, U>(
  values: readonly T[],
  operation: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  for (const value of values) {
    results.push(await operation(value));
  }
  return results;
}

async function mapBounded<T, U>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await operation(values[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
