import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { auditDeck, type AuditFinding, type AuditInput, type CheckResult } from "../runtime/src/qa/audit.js";
import { applySafeRepairs, type RepairPolicy } from "../runtime/src/qa/repair.js";

function finding(id: string, severity: AuditFinding["severity"] = "warning"): AuditFinding {
  return {
    finding_id: id, severity, rule_ref: "layout.text-insets",
    evidence: [{ source_id: "demo", slide_number: 1, element_ref: "body", source_type: "pptx", locator: "slide/1/body" }],
    repairability: "mechanical",
    recommended_fix: {
      action: "set-text-insets", change: "mechanical",
      target: { slide_number: 1, element_ref: "body" },
      parameters: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 },
    },
  };
}

function input(findings: AuditFinding[] = []): AuditInput {
  return {
    deckPath: "demo.pptx", expectedSlideCount: 2,
    capabilities: { pptxRead: true, pptxWrite: true, renderSlides: true, imageAnalysis: true, parallelAgents: false },
    structural: { inspect: async () => ({ findings, checkedSlides: [1, 2] }) },
    visual: {
      render: async () => [{ slideNumber: 1, imagePath: "one.png" }, { slideNumber: 2, imagePath: "two.png" }],
      analyze: async () => ({ findings: [], checkedSlides: [1, 2] }),
    },
  };
}

async function examplePolicy(): Promise<RepairPolicy> {
  return JSON.parse(await readFile(new URL("../instances/example-company/qa/repair-whitelist.json", import.meta.url), "utf8"));
}

test("visual QA cannot run without both declared capabilities", async () => {
  for (const missing of ["imageAnalysis", "renderSlides"] as const) {
    const request = input();
    request.capabilities[missing] = false;
    let rendered = false;
    let analyzed = false;
    const report = await auditDeck({
      ...request,
      visual: {
        render: async () => { rendered = true; return []; },
        analyze: async () => { analyzed = true; return { findings: [], checkedSlides: [1, 2] }; },
      },
    });
    assert.equal(report.structural.status, "passed");
    assert.equal(report.visual.status, "not-run");
    assert.equal(report.status, "incomplete");
    assert.equal(report.coverage.complete, false);
    assert.match(report.coverage.gaps[0]!, new RegExp(missing));
    assert.equal(rendered, false);
    assert.equal(analyzed, false);
  }
});

test("capabilities alone do not imply successful QA without adapters", async () => {
  const report = await auditDeck({ ...input(), structural: undefined, visual: undefined });
  assert.equal(report.structural.status, "not-run");
  assert.equal(report.visual.status, "not-run");
  assert.equal(report.status, "incomplete");
  assert.equal(report.coverage.complete, false);
  assert.match(report.coverage.gaps.join(" "), /structural.*adapter.*visual.*adapter/i);
});

test("structural QA requires pptxRead and never calls its adapter when absent", async () => {
  const request = input();
  request.capabilities.pptxRead = false;
  const report = await auditDeck({ ...request, structural: { inspect: async () => { throw new Error("must not run"); } } });
  assert.equal(report.structural.status, "not-run");
  assert.match(report.coverage.gaps.join(" "), /pptxRead/);
});

test("successful adapters receive the requested deck and rendered slides and cover all slides", async () => {
  const request = input();
  const report = await auditDeck({
    ...request,
    structural: { inspect: async (path) => {
      assert.equal(path, "demo.pptx");
      return { findings: [], checkedSlides: [1, 2] };
    } },
    visual: {
      render: async (path) => {
        assert.equal(path, "demo.pptx");
        return [{ slideNumber: 1, imagePath: "one.png" }, { slideNumber: 2, imagePath: "two.png" }];
      },
      analyze: async (slides) => {
        assert.deepEqual(slides.map((s) => s.imagePath), ["one.png", "two.png"]);
        return { findings: [], checkedSlides: [2, 1] };
      },
    },
  });
  assert.equal(report.status, "passed");
  assert.deepEqual(report.coverage, { complete: true, gaps: [] });
  assert.equal(report.maxSeverity, null);
});

test("partial render, partial analysis, and partial structural checks cannot pass", async () => {
  const base = input();
  for (const request of [
    { ...base, visual: { ...base.visual!, render: async () => [{ slideNumber: 1, imagePath: "one.png" }] } },
    { ...base, visual: { ...base.visual!, analyze: async () => ({ findings: [], checkedSlides: [1] }) } },
    { ...base, structural: { inspect: async () => ({ findings: [], checkedSlides: [1] }) } },
    { ...base, structural: { inspect: async () => ({ findings: [], checkedSlides: [1, 2], gaps: ["font substitution unchecked"] }) } },
  ]) {
    const report = await auditDeck(request);
    assert.equal(report.status, "incomplete");
    assert.equal(report.coverage.complete, false);
    assert.ok(report.coverage.gaps.length > 0);
  }
});

test("adapter failures and malformed results are explicit gaps, not passes", async () => {
  const base = input();
  for (const inspect of [
    async () => { throw new Error("parser unavailable"); },
    async () => ({ findings: [], checkedSlides: [1, 1, 2] }),
    async () => ({ findings: [finding("bad", "invented" as AuditFinding["severity"])], checkedSlides: [1, 2] }),
    async () => ({} as CheckResult),
  ]) {
    const report = await auditDeck({ ...base, structural: { inspect } });
    assert.equal(report.structural.status, "incomplete");
    assert.equal(report.status, "incomplete");
    assert.ok(report.coverage.gaps.length > 0);
  }
  const report = await auditDeck({ ...base, visual: { ...base.visual!, render: async () => { throw new Error("renderer unavailable"); } } });
  assert.equal(report.visual.status, "incomplete");
  assert.match(report.coverage.gaps.join(" "), /renderer unavailable/);
});

test("findings aggregate by severity deterministically, preserving partial-audit failures", async () => {
  const a = finding("z", "critical");
  const b = finding("b", "error");
  const c = finding("a", "error");
  const d = finding("w", "warning");
  const e = finding("i", "info");
  const first = await auditDeck(input([d, b, e, a, c]));
  const second = await auditDeck(input([c, a, e, b, d]));
  assert.deepEqual(first, second);
  assert.deepEqual(first.findings.map((f) => f.finding_id), ["z", "a", "b", "w", "i"]);
  assert.deepEqual(first.severityCounts, { critical: 1, error: 2, warning: 1, info: 1 });
  assert.equal(first.maxSeverity, "critical");
  assert.equal(first.status, "failed");
  const partial = await auditDeck({ ...input([b]), visual: undefined });
  assert.equal(partial.status, "failed");
  assert.equal(partial.coverage.complete, false);
});

test("visual findings join structural findings and retain severity", async () => {
  const base = input([finding("structural", "warning")]);
  const report = await auditDeck({ ...base, visual: { ...base.visual!, analyze: async () => ({ findings: [finding("visual", "error")], checkedSlides: [1, 2] }) } });
  assert.equal(report.visual.status, "failed");
  assert.deepEqual(report.findings.map((f) => f.finding_id), ["visual", "structural"]);
});

test("safe repair produces only the approved mechanical plan without mutating findings", async () => {
  const report = await auditDeck(input([finding("insets")]));
  const before = structuredClone(report);
  const plan = applySafeRepairs(report, await examplePolicy());
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]!.action, "set-text-insets");
  assert.deepEqual(plan.actions[0]!.parameters, { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 });
  assert.equal(plan.approvalRequests.length, 0);
  assert.deepEqual(report, before);
});

test("semantic, classification, data meaning, route, and style changes always require approval", async () => {
  const policy = await examplePolicy();
  for (const change of ["semantic-content", "classification", "data-meaning", "route-selection", "style-selection"] as const) {
    const unsafe = finding(change);
    unsafe.recommended_fix = { ...unsafe.recommended_fix!, change };
    const plan = applySafeRepairs(await auditDeck(input([unsafe])), policy);
    assert.deepEqual(plan.actions, []);
    assert.equal(plan.approvalRequests.length, 1);
    assert.equal(plan.approvalRequests[0]!.status, "pending");
    assert.equal(plan.approvalRequests[0]!.finding_id, change);
  }
});

test("whitelist cannot authorize unknown operations, extra semantic payloads, or unapproved values", async () => {
  const policy = await examplePolicy();
  const original = finding("blocked");
  for (const fix of [
    { ...original.recommended_fix!, action: "rewrite-business-conclusion" },
    { ...original.recommended_fix!, parameters: { ...original.recommended_fix!.parameters, text: "New conclusion" } },
    { ...original.recommended_fix!, parameters: { left: 99, right: 99, top: 99, bottom: 99 } },
    { ...original.recommended_fix!, target: { slide_number: 2, element_ref: "unrelated" } },
  ]) {
    const unsafe = { ...original, recommended_fix: fix };
    const report = await auditDeck(input([unsafe]));
    const plan = applySafeRepairs(report, {
      ...policy,
      whitelist: [...policy.whitelist, { action: fix.action, rule_ref: original.rule_ref, parameters: fix.parameters }],
    });
    assert.equal(plan.actions.length, 0);
    assert.equal(plan.approvalRequests.length, 1);
  }
  const unapproved = applySafeRepairs(await auditDeck(input([original])), { ...policy, status: "candidate" });
  assert.equal(unapproved.actions.length, 0);
  assert.equal(unapproved.approvalRequests.length, 1);
});

test("unlisted rules and findings marked approval-required cannot become automatic repairs", async () => {
  for (const unsafe of [
    { ...finding("approval"), repairability: "approval-required" as const },
    { ...finding("unlisted"), rule_ref: "different-rule" },
  ]) {
    const plan = applySafeRepairs(await auditDeck(input([unsafe])), await examplePolicy());
    assert.equal(plan.actions.length, 0);
    assert.equal(plan.approvalRequests.length, 1);
  }
});

test("approved paragraph spacing is mechanical, but different numeric values require review", async () => {
  const policy = await examplePolicy();
  const spacing = finding("spacing");
  spacing.rule_ref = "typography.paragraph-spacing";
  spacing.recommended_fix = { ...spacing.recommended_fix!, action: "set-paragraph-spacing", parameters: { before: 0, after: 6 } };
  const allowed = applySafeRepairs(await auditDeck(input([spacing])), policy);
  assert.equal(allowed.actions.length, 1);
  assert.deepEqual(allowed.actions[0]!.parameters, { before: 0, after: 6 });
  for (const parameters of [{ before: 0, after: 7 }, { before: 0, after: Number.NaN }]) {
    const changed = { ...spacing, recommended_fix: { ...spacing.recommended_fix, parameters } };
    const plan = applySafeRepairs(await auditDeck(input([changed])), policy);
    assert.equal(plan.actions.length, 0);
    assert.equal(plan.approvalRequests.length, 1);
  }
});

test("incomplete or malformed render coverage prevents analysis from running", async () => {
  for (const slides of [
    [],
    [{ slideNumber: 1, imagePath: "one.png" }],
    [{ slideNumber: 1, imagePath: "one.png" }, { slideNumber: 1, imagePath: "duplicate.png" }],
    [{ slideNumber: 1, imagePath: "one.png" }, { slideNumber: 2, imagePath: "" }],
  ]) {
    let analyzed = false;
    const report = await auditDeck({ ...input(), visual: {
      render: async () => slides,
      analyze: async () => { analyzed = true; return { findings: [], checkedSlides: [1, 2] }; },
    } });
    assert.equal(report.visual.status, "incomplete");
    assert.equal(report.coverage.complete, false);
    assert.equal(analyzed, false);
  }
});

test("repair planning rejects changing action and target accessors before invoking them", async () => {
  const report = await auditDeck(input());
  const policy = await examplePolicy();
  for (const field of ["action", "target"] as const) {
    const proposal = finding("changing-accessor");
    let reads = 0;
    Object.defineProperty(proposal.recommended_fix, field, {
      enumerable: true,
      get: () => {
        reads++;
        if (field === "action") return reads <= 2 ? "set-text-insets" : "rewrite-business-conclusion";
        return reads <= 2 ? { slide_number: 1, element_ref: "body" } : { slide_number: -1, element_ref: "" };
      },
    });
    assert.throws(() => applySafeRepairs({ ...report, findings: [proposal] }, policy), /accessor/i);
    assert.equal(reads, 0);
  }
});

test("repair planning routes malformed matching evidence and targets to approval", async () => {
  const report = await auditDeck(input());
  const policy = await examplePolicy();
  for (const target of [
    { slide_number: -1, element_ref: "body" },
    { slide_number: 0, element_ref: "body" },
    { slide_number: 1.5, element_ref: "body" },
    { slide_number: 1, element_ref: "" },
    { slide_number: 1, element_ref: " " },
  ]) {
    const proposal = finding("forged");
    proposal.recommended_fix = { ...proposal.recommended_fix!, target };
    proposal.evidence = [{ ...proposal.evidence[0]!, ...target }];
    const plan = applySafeRepairs({ ...report, findings: [proposal] }, policy);
    assert.equal(plan.actions.length, 0);
    assert.equal(plan.approvalRequests[0]!.status, "pending");
  }
  const proposal = finding("invalid-source");
  proposal.evidence[0]!.source_id = "";
  const plan = applySafeRepairs({ ...report, findings: [proposal] }, policy);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.approvalRequests[0]!.status, "pending");
});

test("semantic fields on recommendations and targets require approval even when non-enumerable", async () => {
  const report = await auditDeck(input());
  const policy = await examplePolicy();
  for (const level of ["recommendation", "target"] as const) {
    for (const enumerable of [true, false]) {
      const proposal = finding("extra-semantic-field");
      const value = level === "recommendation" ? proposal.recommended_fix : proposal.recommended_fix!.target;
      Object.defineProperty(value, "conclusion", { value: "Rewrite business conclusion", enumerable });
      const plan = applySafeRepairs({ ...report, findings: [proposal] }, policy);
      assert.equal(plan.actions.length, 0);
      assert.equal(plan.approvalRequests[0]!.status, "pending");
    }
  }
});

test("planned mechanical repairs retain an immutable validated snapshot", async () => {
  const proposal = finding("snapshot");
  const report = { ...await auditDeck(input()), findings: [proposal] };
  const plan = applySafeRepairs(report, await examplePolicy());
  proposal.recommended_fix = { ...proposal.recommended_fix!, action: "rewrite-business-conclusion", target: { slide_number: -1, element_ref: "" } };
  const action = plan.actions[0]!;
  assert.equal(action.action, "set-text-insets");
  assert.deepEqual(action.target, { slide_number: 1, element_ref: "body" });
  assert.ok(Object.isFrozen(action));
  assert.ok(Object.isFrozen(action.target));
  assert.ok(Object.isFrozen(action.parameters));
});

test("partial or wrongly typed structural and visual adapter methods yield explicit gaps", async () => {
  const request = input();
  for (const structural of [{}, { inspect: null }, { inspect: "unavailable" }]) {
    const report = await auditDeck({ ...request, structural } as unknown as AuditInput);
    assert.equal(report.structural.status, "not-run");
    assert.equal(report.status, "incomplete");
    assert.match(report.coverage.gaps.join(" "), /structural.*adapter/i);
  }
  for (const visual of [
    {}, { render: request.visual!.render }, { analyze: request.visual!.analyze },
    { render: null, analyze: request.visual!.analyze },
    { render: request.visual!.render, analyze: "unavailable" },
  ]) {
    const report = await auditDeck({ ...request, visual } as unknown as AuditInput);
    assert.equal(report.visual.status, "not-run");
    assert.equal(report.status, "incomplete");
    assert.match(report.coverage.gaps.join(" "), /visual.*adapter/i);
  }
});
