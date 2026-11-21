import assert from "node:assert/strict";
import test from "node:test";

import { detectCapabilities } from "../runtime/src/capabilities/detect.js";
import { validateContract } from "../runtime/src/contracts/validate.js";

const evidence = {
  source_id: "deck-001",
  slide_number: 3,
  element_ref: "shape-7",
  source_type: "pptx-structure",
  locator: "ppt/slides/slide3.xml#shape-7",
};

test("observation validation rejects incomplete payloads", () => {
  assert.equal(validateContract("observation", { confidence: 0.9 }).ok, false);
});

test("observation validation accepts evidence-backed degradation metadata", () => {
  assert.deepEqual(
    validateContract("observation", {
      observation_id: "obs-001",
      category: "typography",
      fact: "Titles use a sans-serif typeface",
      evidence: [evidence],
      confidence: 0.9,
      agent_id: "typography",
      coverage: 0.75,
      missing_capabilities: ["imageAnalysis"],
      unknown_fields: ["font_family"],
    }),
    { ok: true, errors: [] },
  );
});

test("observation validation enforces confidence and coverage bounds", () => {
  const observation = {
    observation_id: "obs-001",
    category: "typography",
    fact: "Titles use a sans-serif typeface",
    evidence: [evidence],
    confidence: 1.01,
    agent_id: "typography",
    coverage: -0.01,
    missing_capabilities: [],
    unknown_fields: [],
  };

  assert.equal(validateContract("observation", observation).ok, false);
});

test("observation validation requires an evidence locator", () => {
  const { locator: _locator, ...unlocatedEvidence } = evidence;
  const observation = {
    observation_id: "obs-001",
    category: "layout",
    fact: "Content follows a two-column layout",
    evidence: [unlocatedEvidence],
    confidence: 0.8,
    agent_id: "layout",
    coverage: 1,
    missing_capabilities: [],
    unknown_fields: [],
  };

  assert.equal(validateContract("observation", observation).ok, false);
});

test("observation validation rejects an empty evidence collection", () => {
  const observation = {
    observation_id: "obs-001",
    category: "layout",
    fact: "Content follows a two-column layout",
    evidence: [],
    confidence: 0.8,
    agent_id: "layout",
    coverage: 1,
    missing_capabilities: [],
    unknown_fields: [],
  };

  assert.equal(validateContract("observation", observation).ok, false);
});

test("rule validation requires a recognized priority", () => {
  const rule = {
    rule_id: "rule-001",
    scope: "style-profile",
    statement: "Use a two-column layout for comparisons",
    observed_value: { columns: 2 },
    priority: "REQUIRED",
    frequency: 0.8,
    evidence: [evidence],
    exceptions: [],
    status: "candidate",
  };

  assert.equal(validateContract("rule", rule).ok, false);
  assert.equal(validateContract("rule", { ...rule, priority: "MUST" }).ok, true);
});

test("rule validation rejects an empty evidence collection", () => {
  const rule = {
    rule_id: "rule-001",
    scope: "style-profile",
    statement: "Use a two-column layout for comparisons",
    observed_value: { columns: 2 },
    priority: "MUST",
    frequency: 0.8,
    evidence: [],
    exceptions: [],
    status: "candidate",
  };

  assert.equal(validateContract("rule", rule).ok, false);
});

test("capability detection returns only the declared capability values", () => {
  assert.deepEqual(
    detectCapabilities({
      pptxRead: true,
      pptxWrite: true,
      renderSlides: false,
      imageAnalysis: false,
      parallelAgents: false,
    }),
    {
      pptxRead: true,
      pptxWrite: true,
      renderSlides: false,
      imageAnalysis: false,
      parallelAgents: false,
    },
  );
});

test("capability validation rejects inferred or omitted capabilities", () => {
  assert.equal(
    validateContract("capability-manifest", {
      pptxRead: true,
      pptxWrite: true,
      renderSlides: false,
      imageAnalysis: false,
    }).ok,
    false,
  );
});
