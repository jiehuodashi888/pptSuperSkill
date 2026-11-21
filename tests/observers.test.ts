import assert from "node:assert/strict";
import test from "node:test";

import {
  OBSERVER_IDS,
  createObservationTask,
  type ObserverId,
} from "../runtime/src/observers/catalog.js";
import { normalizeObservation } from "../runtime/src/observers/normalize.js";

const input = {
  companyId: "example-company",
  level: "slide" as const,
  sourceIds: ["deck-001"],
};

const context = {
  observerId: "typography" as const,
  coverage: 0.75,
  missingCapabilities: ["imageAnalysis" as const],
  unknownFields: ["rendered_font_appearance"],
};

const evidence = {
  source_id: "deck-001",
  slide_number: 3,
  element_ref: "shape-7",
  source_type: "pptx-structure",
  locator: "ppt/slides/slide3.xml#shape-7",
};

test("observer catalog contains exactly the nine distinct contracts in execution order", () => {
  assert.deepEqual(OBSERVER_IDS, [
    "style-classifier",
    "typography",
    "visual-style",
    "layout",
    "master-template",
    "table",
    "chart",
    "visual-asset",
    "content",
  ]);
  assert.equal(new Set(OBSERVER_IDS).size, 9);
});

test("observation tasks identify a local prompt contract without embedding a model adapter", () => {
  const task = createObservationTask("typography", input);

  assert.deepEqual(task, {
    observerId: "typography",
    promptReference:
      ".cursor/skills/enterprise-ppt-multistyle/references/observers/typography.md",
    input,
  });
  assert.equal("provider" in task, false);
  assert.equal("model" in task, false);
  assert.equal("run" in task, false);
});

test("observation task construction rejects unknown observers and unscoped inputs", () => {
  assert.throws(
    () => createObservationTask("not-an-observer" as ObserverId, input),
    /observer/i,
  );
  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        companyId: "",
      }),
    /companyId/i,
  );
  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        sourceIds: [],
      }),
    /sourceIds/i,
  );
});

test("normalization rejects a claimed fact without evidence", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-001",
      category: "typography",
      fact: "Titles use a sans-serif typeface",
      evidence: [],
      confidence: 0.9,
    },
    context,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.coverage, 0.75);
  assert.deepEqual(result.missing_capabilities, ["imageAnalysis"]);
  assert.deepEqual(result.unknown_fields, ["rendered_font_appearance"]);
});

test("normalization rejects malformed evidence and invalid confidence", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-002",
      category: "typography",
      fact: "Body copy uses a regular weight",
      evidence: [{ ...evidence, locator: "" }],
      confidence: 1.1,
    },
    context,
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 1);
});

test("normalization emits a contract-valid observation with degradation metadata", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-003",
      category: "typography",
      fact: "Titles use a sans-serif typeface",
      evidence: [evidence],
      confidence: 0.9,
    },
    context,
  );

  assert.deepEqual(result, {
    ok: true,
    observation: {
      observation_id: "obs-003",
      category: "typography",
      fact: "Titles use a sans-serif typeface",
      evidence: [evidence],
      confidence: 0.9,
      agent_id: "typography",
      coverage: 0.75,
      missing_capabilities: ["imageAnalysis"],
      unknown_fields: ["rendered_font_appearance"],
    },
    coverage: 0.75,
    missing_capabilities: ["imageAnalysis"],
    unknown_fields: ["rendered_font_appearance"],
    errors: [],
  });
});

test("normalization rejects an observer result in another contract category", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-004",
      category: "layout",
      fact: "Titles use a sans-serif typeface",
      evidence: [evidence],
      confidence: 0.9,
    },
    context,
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /category/i);
});
