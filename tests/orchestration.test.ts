import assert from "node:assert/strict";
import test from "node:test";

import type { Observation, Rule } from "../runtime/src/contracts/types.js";
import { auditRun } from "../runtime/src/orchestration/audit.js";
import type { ModelAdapter } from "../runtime/src/orchestration/model-adapter.js";
import {
  observeDeck,
  type ObservationRequest,
  type ObservationRun,
} from "../runtime/src/orchestration/observe.js";
import {
  OBSERVER_IDS,
  type AgentTask,
  type ObservationLevel,
} from "../runtime/src/observers/catalog.js";

const capabilities = {
  pptxRead: true,
  pptxWrite: false,
  renderSlides: true,
  imageAnalysis: true,
  parallelAgents: false,
};

const request: ObservationRequest = {
  companyId: "example-company",
  level: "deck",
  sourceIds: ["deck-001"],
  capabilities,
  maxConcurrency: 3,
};

class RecordingAdapter implements ModelAdapter {
  readonly calls: AgentTask[] = [];

  async run(task: AgentTask): Promise<unknown> {
    this.calls.push(task);
    return rawObservation(task, 0.9);
  }
}

test("serial fallback invokes every observer once in catalog order", async () => {
  const adapter = new RecordingAdapter();

  const run = await observeDeck(request, adapter);

  assert.deepEqual(
    adapter.calls.map(({ observerId }) => observerId),
    OBSERVER_IDS,
  );
  assert.equal(run.executionMode, "serial");
  assert.deepEqual(run.results.map(({ observerId }) => observerId), OBSERVER_IDS);
  assert.equal(run.results.every((result) => result.ok), true);
  assert.deepEqual(auditRun(run).unresolved, []);
});

test("slide, deck, and corpus runs preserve their requested observation level", async () => {
  for (const level of ["slide", "deck", "corpus"] as const) {
    const adapter = new RecordingAdapter();
    const run = await observeDeck({
      ...request,
      level,
      ...(level === "slide"
        ? { slideSelector: { slideNumber: 1, locatorPrefix: "deck-001/slide1.xml" } }
        : {}),
    }, adapter);

    assert.equal(run.level, level);
    assert.equal(adapter.calls.length, 9);
    assert.equal(adapter.calls.every((task) => task.input.level === level), true);
  }
});

test("parallel capability uses bounded concurrency and deterministic result order", async () => {
  let active = 0;
  let peak = 0;
  const completionOrder: string[] = [];
  const adapter: ModelAdapter = {
    async run(task) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) =>
        setTimeout(resolve, (OBSERVER_IDS.length - OBSERVER_IDS.indexOf(task.observerId)) * 2),
      );
      completionOrder.push(task.observerId);
      active -= 1;
      return rawObservation(task, 0.9);
    },
  };

  const run = await observeDeck(
    {
      ...request,
      capabilities: { ...capabilities, parallelAgents: true },
      maxConcurrency: 3,
    },
    adapter,
  );

  assert.equal(run.executionMode, "parallel");
  assert.equal(peak, 3);
  assert.notDeepEqual(completionOrder, [...OBSERVER_IDS]);
  assert.deepEqual(run.results.map(({ observerId }) => observerId), OBSERVER_IDS);
});

test("serial fallback never overlaps adapter calls even when concurrency is requested", async () => {
  let active = 0;
  let peak = 0;
  const adapter: ModelAdapter = {
    async run(task) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return rawObservation(task, 0.9);
    },
  };

  await observeDeck({ ...request, maxConcurrency: 8 }, adapter);

  assert.equal(peak, 1);
});

test("final audit reports conflicts and observer results with absent evidence", () => {
  const first = normalizedObservation("typography", "Titles use 32pt", 0.9);
  const conflicting = {
    ...normalizedObservation("typography", "Titles use 28pt", 0.9),
    observation_id: "typography-conflict",
  };
  const run = manualRun({
    results: [
      { observerId: "typography", ok: true, observations: [first, conflicting], rules: [], classifications: [] },
      {
        observerId: "layout",
        ok: false,
        observations: [],
        rules: [],
        classifications: [],
        errors: ["evidence must NOT have fewer than 1 items"],
      },
    ],
  });

  const audit = auditRun(run);

  assert.deepEqual(
    audit.unresolved.map(({ type }) => type),
    ["conflict", "absent-evidence"],
  );
});

test("final audit reports low-confidence rules and candidate classifications", () => {
  const rule: Rule = {
    rule_id: "rule-001",
    scope: "deck",
    statement: "Use a compact title hierarchy",
    observed_value: { titleSize: 28 },
    priority: "SHOULD",
    frequency: 0.7,
    evidence: [evidence("deck-001")],
    exceptions: [],
    status: "candidate",
  };
  const run = manualRun({
    results: [{
      observerId: "style-classifier",
      ok: true,
      observations: [normalizedObservation("style-classifier", "Candidate style", 0.85)],
      rules: [{ rule, confidence: 0.49 }],
      classifications: [{
        classificationId: "class-001",
        taxonomy: "visual_style",
        label: "data-led",
        confidence: 0.88,
        status: "candidate",
        evidence: [evidence("deck-001")],
      }],
    }],
  });

  const audit = auditRun(run);

  assert.deepEqual(
    audit.unresolved.map(({ type }) => type),
    ["low-confidence-rule", "candidate-classification"],
  );
});

test("observer output is normalized before audit and malformed proposals are retained as failures", async () => {
  const adapter: ModelAdapter = {
    async run(task) {
      if (task.observerId === "table") {
        return { ...rawObservation(task, 0.9), evidence: [] };
      }
      return rawObservation(task, 0.9);
    },
  };

  const run = await observeDeck(request, adapter);
  const table = run.results.find(({ observerId }) => observerId === "table");

  assert.equal(table?.ok, false);
  assert.match(auditRun(run).unresolved.map(({ message }) => message).join("\n"), /table.*evidence/i);
});

test("malformed model rule proposals become audit failures instead of crashing audit", async () => {
  const adapter: ModelAdapter = {
    async run(task) {
      return {
        observations: [rawObservation(task, 0.9)],
        rules: [{ rule: { rule_id: "incomplete" }, confidence: 0.4 }],
      };
    },
  };

  const run = await observeDeck(request, adapter);
  const audit = auditRun(run);

  assert.equal(run.results.every((result) => !result.ok), true);
  assert.equal(audit.unresolved.length, 9);
  assert.equal(audit.unresolved.every(({ type }) => type === "observer-failure"), true);
});

test("an observer envelope with no observations is unresolved absent evidence", async () => {
  const adapter: ModelAdapter = {
    async run() {
      return { observations: [] };
    },
  };

  const run = await observeDeck(request, adapter);
  const audit = auditRun(run);

  assert.equal(run.results.every((result) => !result.ok), true);
  assert.equal(audit.unresolved.length, 9);
  assert.equal(audit.unresolved.every(({ type }) => type === "absent-evidence"), true);
});

test("slide observation evidence must match the requested slide selector and locator prefix", async () => {
  const slideRequest = {
    ...request,
    level: "slide" as const,
    slideSelector: {
      slideNumber: 2,
      locatorPrefix: "deck-001/slide2.xml",
    },
  } as ObservationRequest & {
    slideSelector: { slideNumber: number; locatorPrefix: string };
  };
  const selectors: unknown[] = [];
  const adapter: ModelAdapter = {
    async run(task) {
      const input = task.input as typeof task.input & {
        slideSelector?: { slideNumber: number; locatorPrefix: string };
      };
      selectors.push(input.slideSelector);
      return {
        ...rawObservation(task, 0.9),
        evidence: [{
          ...evidence("deck-001"),
          slide_number: 2,
          locator: "deck-001/slide1.xml#shape-1",
        }],
      };
    },
  };

  const run = await observeDeck(slideRequest, adapter);

  assert.deepEqual(
    selectors.map((selector) => JSON.parse(JSON.stringify(selector)) as unknown),
    Array.from({ length: OBSERVER_IDS.length }, () => slideRequest.slideSelector),
  );
  assert.equal(run.results.every((result) => !result.ok), true);
  assert.match(
    run.results.flatMap((result) => result.ok ? [] : result.errors).join("\n"),
    /locator.*slide selector/i,
  );
});

test("slide selectors are required only for slide-level requests", async () => {
  const adapter = new RecordingAdapter();

  await assert.rejects(
    observeDeck({ ...request, level: "slide" }, adapter),
    /requires a slideSelector/i,
  );
  await assert.rejects(
    observeDeck({
      ...request,
      slideSelector: { slideNumber: 1, locatorPrefix: "deck-001/slide1.xml" },
    }, adapter),
    /only valid for slide/i,
  );
  assert.equal(adapter.calls.length, 0);
});

test("observation, rule, and classification evidence cannot escape request sources or level", async () => {
  const adapter: ModelAdapter = {
    async run(task) {
      const foreignEvidence = evidence("other-company:deck-999");
      return {
        observations: [{
          ...rawObservation(task, 0.9),
          evidence: [foreignEvidence],
        }],
        rules: [{
          rule: {
            ...candidateRule("rule-foreign"),
            scope: "corpus",
            evidence: [foreignEvidence],
          },
          confidence: 0.9,
        }],
        classifications: [{
          classificationId: "class-foreign",
          taxonomy: "visual_style",
          label: "foreign",
          confidence: 0.9,
          status: "candidate",
          evidence: [foreignEvidence],
        }],
      };
    },
  };

  const run = await observeDeck(request, adapter);

  assert.equal(run.results.every((result) => !result.ok), true);
  assert.equal(run.results.every((result) => result.observations.length === 0), true);
  assert.equal(run.results.every((result) => result.rules.length === 0), true);
  assert.equal(run.results.every((result) => result.classifications.length === 0), true);
  assert.match(
    run.results.flatMap((result) => result.ok ? [] : result.errors).join("\n"),
    /source|scope/i,
  );
});

test("present rule and classification fields must be arrays", async () => {
  const adapter: ModelAdapter = {
    async run(task) {
      return {
        observations: [rawObservation(task, 0.9)],
        rules: { rule: candidateRule("not-an-array"), confidence: 0.9 },
        classifications: "not-an-array",
      };
    },
  };

  const run = await observeDeck(request, adapter);

  assert.equal(run.results.every((result) => !result.ok), true);
  assert.match(
    run.results.flatMap((result) => result.ok ? [] : result.errors).join("\n"),
    /rules must be an array.*classifications must be an array/is,
  );
});

test("final audit rejects missing, duplicate, and unexpected observer results", () => {
  const complete = manualRun({ results: [] });
  const typography = complete.results.find(
    ({ observerId }) => observerId === "typography",
  )!;
  const malformed: ObservationRun = {
    ...complete,
    results: [
      ...complete.results.filter(({ observerId }) => observerId !== "content"),
      typography,
      {
        ...typography,
        observerId: "unexpected-observer",
      } as unknown as ObservationRun["results"][number],
    ],
  };

  const audit = auditRun(malformed);

  assert.equal(audit.complete, false);
  const integrityMessages = audit.unresolved
    .filter(({ type }) => type === "catalog-integrity")
    .map(({ message }) => message);
  for (const expected of [
    "Missing observer result: content",
    "Duplicate observer result: typography",
    "Unexpected observer result: unexpected-observer",
  ]) {
    assert.equal(integrityMessages.includes(expected), true);
  }
});

test("final audit never completes an empty partial run", () => {
  const audit = auditRun({
    companyId: "example-company",
    level: "deck",
    sourceIds: ["deck-001"],
    executionMode: "serial",
    results: [],
  });

  assert.equal(audit.complete, false);
  assert.equal(
    audit.unresolved.filter(({ type }) => type === "catalog-integrity").length,
    OBSERVER_IDS.length,
  );
});

test("final audit detects conflicting payloads that reuse observation and rule identities", () => {
  const duplicateObservationId = "observation-shared-id";
  const duplicateRuleId = "rule-shared-id";
  const run = manualRun({
    results: [
      {
        observerId: "typography",
        ok: true,
        observations: [{
          ...normalizedObservation("typography", "Typography payload", 0.9),
          observation_id: duplicateObservationId,
        }],
        rules: [{
          rule: {
            ...candidateRule(duplicateRuleId),
            statement: "Typography rule payload",
          },
          confidence: 0.9,
        }],
        classifications: [],
      },
      {
        observerId: "layout",
        ok: true,
        observations: [{
          ...normalizedObservation("layout", "Layout payload", 0.9),
          observation_id: duplicateObservationId,
        }],
        rules: [{
          rule: {
            ...candidateRule(duplicateRuleId),
            statement: "Layout rule payload",
          },
          confidence: 0.9,
        }],
        classifications: [],
      },
    ],
  });

  const conflicts = auditRun(run).unresolved.filter(({ type }) => type === "conflict");

  assert.deepEqual(
    conflicts.map(({ message }) => message),
    [
      `Conflicting payloads reuse observation_id ${duplicateObservationId}`,
      `Conflicting payloads reuse rule_id ${duplicateRuleId}`,
    ],
  );
});

test("slide locators reject path-prefix confusion, traversal, and ambiguous segments", async () => {
  const slideRequest: ObservationRequest = {
    ...request,
    level: "slide",
    slideSelector: {
      slideNumber: 2,
      locatorPrefix: "deck-001/slide2.xml",
    },
  };
  const invalidLocators = [
    "deck-001/slide2.xml.evil#shape-1",
    "deck-001/slide2.xml/../other.xml#shape-1",
    "deck-001/slide2.xml//shape-1",
  ];
  let callIndex = 0;
  const adapter: ModelAdapter = {
    async run(task) {
      const locator = invalidLocators[callIndex % invalidLocators.length]!;
      callIndex += 1;
      return {
        ...rawObservation(task, 0.9),
        evidence: [{
          ...evidence("deck-001"),
          slide_number: 2,
          locator,
        }],
      };
    },
  };

  const run = await observeDeck(slideRequest, adapter);

  assert.equal(run.results.every((result) => !result.ok), true);
  assert.match(
    run.results.flatMap((result) => result.ok ? [] : result.errors).join("\n"),
    /document locator|traversal|ambiguous/i,
  );
});

test("slide selectors reject traversal before invoking the adapter", async () => {
  const adapter = new RecordingAdapter();

  await assert.rejects(
    observeDeck({
      ...request,
      level: "slide",
      slideSelector: {
        slideNumber: 2,
        locatorPrefix: "deck-001/slides/../slide2.xml",
      },
    }, adapter),
    /locator|traversal|ambiguous/i,
  );
  assert.equal(adapter.calls.length, 0);
});

test("final audit rejects catalog slots whose observations belong to another observer", () => {
  const sharedObservation = normalizedObservation(
    "typography",
    "Copied typography result",
    0.9,
  );
  const run: ObservationRun = {
    ...manualRun({ results: [] }),
    results: OBSERVER_IDS.map((observerId) => ({
      observerId,
      ok: true,
      observations: [sharedObservation],
      rules: [],
      classifications: [],
    })),
  };

  const audit = auditRun(run);

  assert.equal(audit.complete, false);
  assert.equal(
    audit.unresolved.filter(({ message }) => /does not belong to observer/i.test(message)).length,
    OBSERVER_IDS.length - 1,
  );
});

test("final audit rejects successful catalog slots without evidence-backed observations", () => {
  const run: ObservationRun = {
    ...manualRun({ results: [] }),
    results: OBSERVER_IDS.map((observerId) => ({
      observerId,
      ok: true,
      observations: [],
      rules: [],
      classifications: [],
    })),
  };

  const audit = auditRun(run);

  assert.equal(audit.complete, false);
  assert.equal(
    audit.unresolved.filter(({ message }) => /evidence-backed observation/i.test(message)).length,
    OBSERVER_IDS.length,
  );
});

test("final audit rejects a successful observation whose evidence is empty", () => {
  const complete = manualRun({ results: [] });
  const run: ObservationRun = {
    ...complete,
    results: complete.results.map((result) =>
      result.observerId === "typography"
        ? {
            ...result,
            observations: result.observations.map((observation) => ({
              ...observation,
              evidence: [],
            })),
          }
        : result
    ),
  };

  const audit = auditRun(run);

  assert.equal(audit.complete, false);
  assert.equal(
    audit.unresolved.some(({ message }) => /observation without evidence/i.test(message)),
    true,
  );
});

test("raw observation shorthand cannot bypass non-array proposal validation", async () => {
  const adapter: ModelAdapter = {
    async run(task) {
      return {
        ...rawObservation(task, 0.9),
        rules: { rule: candidateRule("shorthand-rule"), confidence: 0.9 },
        classifications: "shorthand-classification",
      };
    },
  };

  const run = await observeDeck(request, adapter);

  assert.equal(run.results.every((result) => !result.ok), true);
  assert.match(
    run.results.flatMap((result) => result.ok ? [] : result.errors).join("\n"),
    /rules must be an array.*classifications must be an array/is,
  );
});

test("model classifications cannot self-approve or bypass final approval audit", async () => {
  const run = await observeDeck(request, {
    async run(task) {
      return {
        observations: [rawObservation(task, 0.9)],
        classifications: [{
          classificationId: `class-${task.observerId}`, taxonomy: "visual_style",
          label: "data-led", confidence: 0.9, status: "approved",
          evidence: [evidence("deck-001")],
        }],
      };
    },
  });
  assert.equal(auditRun(run).complete, false);
  assert.equal(run.results.every((result) => !result.ok), true);
});

test("audit requires approval even for a directly supplied approved classification", () => {
  const run = manualRun({ results: [{
    observerId: "style-classifier", ok: true,
    observations: [normalizedObservation("style-classifier", "Style fact", 0.9)],
    rules: [], classifications: [{
      classificationId: "forged", taxonomy: "visual_style", label: "data-led",
      confidence: 0.9, status: "approved", evidence: [evidence("deck-001")],
    }],
  }] });
  assert.equal(auditRun(run).complete, false);
  assert.equal(auditRun(run).unresolved.some(({ type }) => type === "candidate-classification"), true);
});

test("in-flight caller mutation cannot relabel observation tasks or report scope", async () => {
  const mutable = { ...request, sourceIds: ["deck-001"], capabilities: { ...capabilities } };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: AgentTask[] = [];
  const pending = observeDeck(mutable, {
    async run(task) {
      calls.push(task);
      await gate;
      return rawObservation(task, 0.9);
    },
  });
  mutable.companyId = "other-company";
  mutable.level = "corpus";
  mutable.sourceIds[0] = "other-source";
  mutable.capabilities.parallelAgents = true;
  release();
  const run = await pending;
  assert.equal(run.companyId, "example-company");
  assert.equal(run.level, "deck");
  assert.deepEqual(run.sourceIds, ["deck-001"]);
  assert.equal(run.executionMode, "serial");
  assert.equal(calls.every(({ input }) => input.companyId === "example-company" && input.level === "deck" && input.sourceIds[0] === "deck-001"), true);
  assert.equal(auditRun(run).complete, true);
});

test("final audit distinguishes compatible font properties on one element", () => {
  const run = manualRun({ results: [{
    observerId: "typography", ok: true, rules: [], classifications: [],
    observations: [
      { ...normalizedObservation("typography", "Font family is Arial", 0.9), observation_id: "family" },
      { ...normalizedObservation("typography", "Font size is 32pt", 0.9), observation_id: "size" },
    ],
  }] });
  assert.equal(auditRun(run).complete, true);
});

test("explicit claim properties preserve conflicts without conflating distinct claims", async () => {
  const run = await observeDeck(request, {
    async run(task) {
      if (task.observerId !== "typography") return rawObservation(task, 0.9);
      return { observations: [
        { ...rawObservation(task, 0.9), observation_id: "family", property: "font_family", fact: "Arial" },
        { ...rawObservation(task, 0.9), observation_id: "size", property: "font_size", fact: "32pt" },
        { ...rawObservation(task, 0.9), observation_id: "size-conflict", property: "font_size", fact: "28pt" },
      ] };
    },
  });
  const conflicts = auditRun(run).unresolved.filter(({ type }) => type === "conflict");
  assert.deepEqual(conflicts.map(({ references }) => references), [["size", "size-conflict"]]);
});

function rawObservation(
  task: AgentTask,
  confidence: number,
): Record<string, unknown> {
  return {
    observation_id: `obs-${task.observerId}`,
    category: task.observerId,
    fact: `${task.observerId} fact`,
    evidence: [evidence(task.input.sourceIds[0]!)],
    confidence,
  };
}

function normalizedObservation(
  category: (typeof OBSERVER_IDS)[number],
  fact: string,
  confidence: number,
): Observation {
  return {
    observation_id: `obs-${category}`,
    category,
    fact,
    evidence: [evidence("deck-001")],
    confidence,
    agent_id: category,
    coverage: 1,
    missing_capabilities: [],
    unknown_fields: [],
  };
}

function candidateRule(ruleId: string): Rule {
  return {
    rule_id: ruleId,
    scope: "deck",
    statement: "Use a compact title hierarchy",
    observed_value: { titleSize: 28 },
    priority: "SHOULD",
    frequency: 0.7,
    evidence: [evidence("deck-001")],
    exceptions: [],
    status: "candidate",
  };
}

function evidence(sourceId: string) {
  return {
    source_id: sourceId,
    slide_number: 1,
    element_ref: "shape-1",
    source_type: "pptx-structure",
    locator: `${sourceId}/slide1.xml#shape-1`,
  };
}

function manualRun(overrides: Pick<ObservationRun, "results">): ObservationRun {
  const overridesByObserver = new Map(
    overrides.results.map((result) => [result.observerId, result]),
  );
  return {
    companyId: "example-company",
    level: "deck" as ObservationLevel,
    sourceIds: ["deck-001"],
    executionMode: "serial",
    results: OBSERVER_IDS.map((observerId) =>
      overridesByObserver.get(observerId) ?? {
        observerId,
        ok: true,
        observations: [normalizedObservation(
          observerId,
          `${observerId} baseline`,
          0.9,
        )],
        rules: [],
        classifications: [],
      }
    ),
  };
}
