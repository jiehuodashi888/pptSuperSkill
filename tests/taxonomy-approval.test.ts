import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv from "ajv";

import {
  proposeClassification,
  type ApprovedTaxonomy,
  type ClassificationProposal,
  type StyleProfile,
} from "../runtime/src/contracts/taxonomy.js";
import {
  applyApproval,
  isAuthenticTerminalApprovalState,
  type ApprovalDecision,
  type ApprovalState,
} from "../runtime/src/approvals/state-machine.js";

const evidence = {
  source_id: "example-deck",
  slide_number: 2,
  element_ref: "title-1",
  source_type: "pptx-structure",
  locator: "ppt/slides/slide2.xml#title-1",
};

const proposal: ClassificationProposal = {
  proposal_id: "proposal-001",
  dimension: "visual_style",
  candidate: {
    id: "editorial",
    name: "Editorial",
    tags: ["high-contrast", "serif-accent"],
  },
  evidence: [evidence],
  proposed_by: "style-observer",
};

test("candidate approval transitions to approved", () => {
  const candidate = proposeClassification(proposal);

  assert.equal(applyApproval(candidate, { action: "approve" }).status, "approved");
});

test("formal taxonomy actions cannot bypass an approval request", () => {
  const approved = applyApproval(proposeClassification(proposal), {
    action: "approve",
  });
  const directChanges: ApprovalDecision[] = [
    { action: "publish" },
    { action: "rename", newName: "x" },
    { action: "merge", target_ids: ["editorial", "minimal"] },
    { action: "split", entries: [{ id: "x", name: "X", tags: [] }] },
    { action: "deprecate" },
  ];

  for (const change of directChanges) {
    assert.throws(() => applyApproval(approved, change), /approval request/i);
  }
});

test("an issued request is single-use and its terminal result is immutable", () => {
  const candidate = proposeClassification(proposal);
  const approved = applyApproval(candidate, { action: "approve" });

  assert.equal(Object.isFrozen(approved), true);
  assert.throws(() => {
    (approved as { status: string }).status = "candidate";
  }, /read only|readonly|assign/i);
  assert.equal(approved.status, "approved");
  assert.throws(
    () => applyApproval(candidate, { action: "approve" }),
    /already decided/i,
  );
});

test("a caller-created candidate cannot self-assert approval provenance", () => {
  const issued = proposeClassification(proposal);
  const callerCreated = structuredClone(issued) as ApprovalState;

  assert.throws(
    () => applyApproval(callerCreated, { action: "approve" }),
    /issued classification proposal/i,
  );
});

test("terminal-state authentication rejects a spread candidate with self-asserted status", () => {
  const candidate = proposeClassification(proposal);
  const forgedTerminal = { ...candidate, status: "approved" };
  const genuineTerminal = applyApproval(candidate, { action: "approve" });

  assert.equal(isAuthenticTerminalApprovalState(forgedTerminal), false);
  assert.equal(isAuthenticTerminalApprovalState(genuineTerminal), true);
});

test("approval rejects empty or malformed evidence at the state-machine boundary", () => {
  const issued = proposeClassification(proposal);
  const emptyEvidence = { ...issued, evidence: [] } as ApprovalState;
  const malformedEvidence = {
    ...issued,
    evidence: [{ ...evidence, locator: "" }],
  } as ApprovalState;

  assert.throws(
    () => applyApproval(emptyEvidence, { action: "approve" }),
    /invalid approval request.*evidence/i,
  );
  assert.throws(
    () => applyApproval(malformedEvidence, { action: "approve" }),
    /invalid approval request.*locator/i,
  );
});

test("classification proposals and additive tags leave approved taxonomy untouched", () => {
  const taxonomy: ApprovedTaxonomy = {
    dimension: "visual_style",
    entries: [{ id: "minimal", name: "Minimal", tags: ["spacious"] }],
  };
  const beforeTaxonomy = structuredClone(taxonomy);

  const request = proposeClassification({
    ...proposal,
    candidate: {
      id: "minimal",
      name: "Minimal",
      tags: ["spacious", "restrained-color"],
    },
  });

  assert.deepEqual(taxonomy, beforeTaxonomy);
  assert.equal(request.status, "candidate");
  assert.equal(request.change.action, "publish");
  if (request.change.action === "publish") {
    assert.deepEqual(request.change.candidate.tags, ["spacious", "restrained-color"]);
  }
});

test("business type, visual style, and layout pattern remain independent", () => {
  const profile: StyleProfile = {
    profile_id: "default",
    business_type: "quarterly-review",
    visual_style: "minimal",
    layout_pattern: "title-and-two-column",
    tags: ["executive-ready"],
  };

  assert.equal(profile.business_type, "quarterly-review");
  assert.equal(profile.visual_style, "minimal");
  assert.equal(profile.layout_pattern, "title-and-two-column");
});

test("style profile and approval schemas accept representative contracts", async () => {
  const ajv = new Ajv.default({ strict: true });
  const [styleSchema, approvalSchema] = await Promise.all([
    readJson(new URL("../runtime/schemas/style-profile.schema.json", import.meta.url)),
    readJson(new URL("../runtime/schemas/approval.schema.json", import.meta.url)),
  ]);
  const validateStyle = ajv.compile(styleSchema);
  const validateApproval = ajv.compile(approvalSchema);

  assert.equal(
    validateStyle({
      profile_id: "default",
      business_type: "quarterly-review",
      visual_style: "minimal",
      layout_pattern: "title-and-two-column",
      tags: ["executive-ready"],
    }),
    true,
  );
  assert.equal(validateApproval(proposeClassification(proposal)), true);
  assert.equal(
    validateApproval({
      ...structuredClone(proposeClassification(proposal)),
      status: "approved",
    }),
    false,
  );
});

test("example-company taxonomies are separate and contain generic example data", async () => {
  const [businessTypes, visualStyles, layoutPatterns] = await Promise.all([
    readJson(new URL("../instances/example-company/taxonomy/business-types.json", import.meta.url)),
    readJson(new URL("../instances/example-company/taxonomy/visual-styles.json", import.meta.url)),
    readJson(new URL("../instances/example-company/taxonomy/layout-patterns.json", import.meta.url)),
  ]);

  assert.equal(businessTypes.dimension, "business_type");
  assert.equal(visualStyles.dimension, "visual_style");
  assert.equal(layoutPatterns.dimension, "layout_pattern");
  assert.ok(businessTypes.entries.length > 0);
  assert.ok(visualStyles.entries.length > 0);
  assert.ok(layoutPatterns.entries.length > 0);
});

async function readJson(url: URL): Promise<any> {
  return JSON.parse(await readFile(url, "utf8"));
}
