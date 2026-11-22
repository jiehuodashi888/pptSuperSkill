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
  snapshotObservationInput,
  type AgentTask,
  type ObservationInput,
  type ObservationLevel,
  type ObserverId,
  type SlideSelector,
} from "../observers/catalog.js";
import { normalizeObservation } from "../observers/normalize.js";
import type { ModelAdapter } from "./model-adapter.js";

const DEFAULT_PARALLELISM = 4;
const MAX_PARALLELISM = 4;

export interface ObservationRequest {
  readonly companyId: string;
  readonly level: ObservationLevel;
  readonly sourceIds: readonly string[];
  readonly slideSelector?: SlideSelector;
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
  const snapshot = snapshotRequest(request);
  validateRequestScope(snapshot);
  const concurrency = requestedConcurrency(snapshot);
  const executionMode = snapshot.capabilities.parallelAgents
    ? "parallel"
    : "serial";
  const tasks = createTasks(snapshot);
  const execute = (task: AgentTask) => executeTask(task, adapter);
  const results = executionMode === "parallel"
    ? await mapBounded(tasks, concurrency, execute)
    : await mapSerial(tasks, execute);

  return Object.freeze({
    companyId: snapshot.companyId,
    level: snapshot.level,
    sourceIds: Object.freeze([...snapshot.sourceIds]),
    executionMode,
    results: Object.freeze(results),
  });
}

function snapshotRequest(request: ObservationRequest): ObservationRequest {
  if (!isRecord(request) || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) {
    throw new Error("Observation request must be a plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(request);
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor)) throw new Error("Observation request requires data fields, not accessors");
  }
  const { maxConcurrency: concurrencyDescriptor, ...inputDescriptors } = descriptors;
  const maxConcurrency = concurrencyDescriptor?.value as number | undefined;
  const input = snapshotObservationInput(Object.defineProperties({}, inputDescriptors) as ObservationInput);
  if (input.capabilities === undefined) throw new Error("Observation request requires capabilities");
  return Object.freeze({ ...input, capabilities: input.capabilities, maxConcurrency });
}

function createTasks(request: ObservationRequest): AgentTask[] {
  const input: ObservationInput = {
    companyId: request.companyId,
    level: request.level,
    sourceIds: request.sourceIds,
    ...(request.slideSelector === undefined
      ? {}
      : { slideSelector: request.slideSelector }),
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
  const observations: Observation[] = [];
  const errors: string[] = [];
  for (const result of normalized) {
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    const scopeErrors = evidenceScopeErrors(result.observation.evidence, task.input);
    if (scopeErrors.length > 0) {
      errors.push(...scopeErrors.map((error) =>
        `Observation ${result.observation.observation_id}: ${error}`
      ));
    } else {
      observations.push(result.observation);
    }
  }
  errors.push(...envelope.errors);
  const rules = envelope.rules.filter(({ rule }) => {
    const scopeErrors = [
      ...(rule.scope === task.input.level
        ? []
        : [`rule scope ${rule.scope} does not match request level ${task.input.level}`]),
      ...evidenceScopeErrors(rule.evidence, task.input),
    ];
    errors.push(...scopeErrors.map((error) => `Rule ${rule.rule_id}: ${error}`));
    return scopeErrors.length === 0;
  });
  const classifications = envelope.classifications.filter((classification) => {
    const scopeErrors = evidenceScopeErrors(classification.evidence, task.input);
    errors.push(...scopeErrors.map((error) =>
      `Classification ${classification.classificationId}: ${error}`
    ));
    return scopeErrors.length === 0;
  });

  if (errors.length > 0) {
    return {
      observerId: task.observerId,
      ok: false,
      observations,
      rules,
      classifications,
      errors,
    };
  }
  return {
    observerId: task.observerId,
    ok: true,
    observations,
    rules,
    classifications,
  };
}

function validateRequestScope(request: ObservationRequest): void {
  if (request.level === "slide" && request.slideSelector === undefined) {
    throw new Error("Slide observation requires a slideSelector");
  }
  if (request.level !== "slide" && request.slideSelector !== undefined) {
    throw new Error("slideSelector is only valid for slide observation");
  }
  if (request.slideSelector !== undefined) {
    const parsed = parseLocator(request.slideSelector.locatorPrefix, false);
    if (!parsed.ok) {
      throw new Error(`Invalid slide selector locator: ${parsed.error}`);
    }
  }
}

function evidenceScopeErrors(
  evidenceItems: readonly Evidence[],
  input: ObservationInput,
): string[] {
  const allowedSources = new Set(input.sourceIds);
  const errors: string[] = [];
  for (const evidence of evidenceItems) {
    if (!allowedSources.has(evidence.source_id)) {
      errors.push(`evidence source ${evidence.source_id} is outside request sources`);
    }
    if (input.level === "slide") {
      const selector = input.slideSelector!;
      if (evidence.slide_number !== selector.slideNumber) {
        errors.push(
          `evidence slide ${evidence.slide_number} does not match slide selector ${selector.slideNumber}`,
        );
      }
      const expected = parseLocator(selector.locatorPrefix, false);
      const actual = parseLocator(evidence.locator, true);
      if (!actual.ok) {
        errors.push(`evidence locator is invalid: ${actual.error}`);
      } else if (!expected.ok || actual.document !== expected.document) {
        errors.push(
          `evidence document locator ${actual.document} does not exactly match slide selector ${selector.locatorPrefix}`,
        );
      }
    }
  }
  return errors;
}

type ParsedLocator =
  | { readonly ok: true; readonly document: string }
  | { readonly ok: false; readonly error: string };

function parseLocator(locator: string, allowFragment: boolean): ParsedLocator {
  if (locator.trim() !== locator || locator === "") {
    return { ok: false, error: "locator must be non-empty without surrounding whitespace" };
  }
  if (/[/\\]$/.test(locator) || locator.includes("\\") || locator.includes("?")) {
    return { ok: false, error: "locator contains an ambiguous path boundary" };
  }
  const hash = locator.indexOf("#");
  if (hash !== -1 && locator.indexOf("#", hash + 1) !== -1) {
    return { ok: false, error: "locator contains multiple fragment boundaries" };
  }
  if (!allowFragment && hash !== -1) {
    return { ok: false, error: "selector locator must identify a document without a fragment" };
  }
  const document = hash === -1 ? locator : locator.slice(0, hash);
  const fragment = hash === -1 ? undefined : locator.slice(hash + 1);
  if (fragment !== undefined && (fragment === "" || /[\u0000-\u001f]/.test(fragment))) {
    return { ok: false, error: "locator has an invalid fragment boundary" };
  }
  const segments = document.split("/");
  if (segments.some((segment) => segment === "")) {
    return { ok: false, error: "locator contains ambiguous empty path segments" };
  }
  const canonical: string[] = [];
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return { ok: false, error: "locator contains invalid percent encoding" };
    }
    if (
      decoded === "." || decoded === ".." ||
      decoded.includes("/") || decoded.includes("\\")
    ) {
      return { ok: false, error: "locator contains traversal or ambiguous path segments" };
    }
    if (/[\u0000-\u001f]/.test(decoded)) {
      return { ok: false, error: "locator contains control characters" };
    }
    canonical.push(decoded);
  }
  return { ok: true, document: canonical.join("/") };
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
  if (!isRecord(raw)) {
    return { observations: [raw], rules: [], classifications: [], errors: [] };
  }
  const hasObservations = Object.hasOwn(raw, "observations");
  const hasRules = Object.hasOwn(raw, "rules");
  const hasClassifications = Object.hasOwn(raw, "classifications");
  const shorthandErrors: string[] = [];
  if (hasRules && !Array.isArray(raw.rules)) {
    shorthandErrors.push("Observer output rules must be an array");
  }
  if (hasClassifications && !Array.isArray(raw.classifications)) {
    shorthandErrors.push("Observer output classifications must be an array");
  }
  if (!hasObservations) {
    if (
      (hasRules && Array.isArray(raw.rules)) ||
      (hasClassifications && Array.isArray(raw.classifications))
    ) {
      shorthandErrors.push(
        "Observer proposal fields require an observations array envelope",
      );
    }
    return {
      observations: [raw],
      rules: [],
      classifications: [],
      errors: shorthandErrors,
    };
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
  if (hasRules && !Array.isArray(raw.rules)) {
    errors.push("Observer output rules must be an array");
  }
  if (
    hasClassifications &&
    !Array.isArray(raw.classifications)
  ) {
    errors.push("Observer output classifications must be an array");
  }
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
    // Model output is a proposal; lifecycle transitions require authenticated approval.
    value.status === "candidate" &&
    Array.isArray(value.evidence) && value.evidence.every(isEvidence);
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
