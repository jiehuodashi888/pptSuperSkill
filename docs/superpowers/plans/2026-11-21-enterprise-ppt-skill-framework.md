# Enterprise PPT Skill Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a model-agnostic, local-first enterprise PPT SKILL that learns multi-style design rules, routes generation requests, produces editable PPTX files from zero, and isolates every company instance.

**Architecture:** The distributable project skill owns workflow, agent prompts and JSON contracts; a TypeScript local runtime implements capability detection, instance isolation, orchestration, routing, generation, QA and an optional local review UI. Companies contribute only separate local instance packages. Every runtime action begins with a company-scoped manifest and degrades by recording coverage gaps rather than inventing unavailable observations.

**Tech Stack:** Node.js 20+, TypeScript, Node test runner, JSON Schema + Ajv, PptxGenJS, local filesystem, built-in Node HTTP server.

**Spec:** `docs/superpowers/specs/2026-11-21-enterprise-ppt-skill-framework-design.md`

## Global Constraints

- Core code must not contain company names, proprietary templates, style values or source samples.
- Every runtime request carries a validated `company_id`; cross-instance paths and references are rejected.
- `native-create` creates an editable PPTX from zero; template-fill and existing-deck-edit remain capability-gated adapters.
- Every observer must emit evidence, confidence, coverage, missing capabilities and unknown fields.
- Business type, visual style and layout pattern are independent taxonomies; formal classification changes require an approval decision.
- A missing capability must return a structured degradation result, never a fabricated observation or successful QA claim.
- Local UI is optional; file/CLI approval contracts remain the canonical compatible interface.
- Public samples are test-only, recorded with source URL, file hash, use note and license/usage note; no public or enterprise sample crosses an instance boundary.
- Implement every behavior test-first and run the complete test suite before each commit.

## Review Focus

- A malicious or malformed `company_id`, `source_id`, or template reference must not escape an instance root; cover in Task 3.
- A runtime without image analysis must report visual coverage gaps and must not mark visual QA passed; cover in Tasks 2 and 9.
- A legacy taxonomy must remain byte-for-byte equivalent after a candidate style is proposed; cover in Tasks 4 and 8.
- A serial fallback must invoke all nine observer contracts exactly once; cover in Task 6.
- An unresolved route or approval must never select a style or generate a final deck; cover in Task 8.

---

## Planned File Structure

| Path | Responsibility |
| --- | --- |
| `package.json`, `tsconfig.json` | Reproducible Node/TypeScript build, test and CLI commands. |
| `.cursor/skills/enterprise-ppt-multistyle/SKILL.md` | Concise operator workflow and trigger conditions. |
| `.cursor/skills/enterprise-ppt-multistyle/references/*.md` | Agent workflow, instance package and approval guidance. |
| `runtime/src/contracts/*.ts` | TypeScript representations of the versioned data contracts. |
| `runtime/schemas/*.schema.json` | Runtime-validated JSON Schema contracts. |
| `runtime/src/capabilities/*.ts` | Capability manifest detection and degradation decisions. |
| `runtime/src/instances/*.ts` | Instance manifest loading, path scoping and asset references. |
| `runtime/src/observers/*.ts` | Nine observer definitions, prompt loading and normalized observation results. |
| `runtime/src/orchestration/*.ts` | Slide/deck/corpus jobs, serial/parallel execution and final audit. |
| `runtime/src/routing/*.ts` | Scenario matching and approval-gated routing. |
| `runtime/src/generation/*.ts` | Adapter interface and native editable-PPTX implementation. |
| `runtime/src/qa/*.ts` | Structural/visual capability-gated audit aggregation and mechanical repair whitelist. |
| `runtime/src/approvals/*.ts` | Approval request/decision file state machine. |
| `runtime/src/ui/*.ts`, `runtime/public/*` | Optional localhost review UI over the same approval contracts. |
| `instances/example-company/*` | Data-free example instance package, taxonomy, policy and test fixtures. |
| `tests/**/*.test.ts` | Unit, contract and end-to-end tests. |
| `scripts/fetch-public-fixture.ts` | Explicit opt-in public fixture acquisition and provenance recording. |

### Task 1: Bootstrap the local runtime and distributable SKILL

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `runtime/src/index.ts`
- Create: `tests/smoke.test.ts`
- Create: `.cursor/skills/enterprise-ppt-multistyle/SKILL.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/instance-package.md`

**Interfaces:**
- Produces: `npm test`, `npm run typecheck`, and `npm run ppt-skill` commands; the skill entrypoint references only runtime commands and one-level-deep references.

- [ ] **Step 1: Write the failing smoke test**

```ts
import { frameworkVersion } from "../runtime/src/index.js";
import assert from "node:assert/strict";

assert.match(frameworkVersion, /^0\.1\.0$/);
```

- [ ] **Step 2: Run the smoke test and verify it fails**

Run: `npm test -- tests/smoke.test.ts`

Expected: FAIL because the runtime entrypoint does not exist.

- [ ] **Step 3: Add the minimum Node/TypeScript scaffold and `frameworkVersion: string` export**

Use Node 20 ESM with `module`/`moduleResolution` set to `NodeNext`; add `test`, `typecheck` and `ppt-skill` scripts, with `typescript`, `ajv` and `pptxgenjs` declared dependencies. Keep the `SKILL.md` below 500 lines with a `Use when...` discovery description, and point detailed material to the two reference files.

- [ ] **Step 4: Verify scaffold quality**

Run: `npm test -- tests/smoke.test.ts && npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json runtime/src/index.ts tests/smoke.test.ts .cursor/skills/enterprise-ppt-multistyle
git commit -m "chore: scaffold enterprise PPT skill runtime"
```

### Task 2: Define and validate the shared contracts plus capability manifest

**Files:**
- Create: `runtime/src/contracts/types.ts`
- Create: `runtime/src/contracts/validate.ts`
- Create: `runtime/src/capabilities/detect.ts`
- Create: `runtime/schemas/capability-manifest.schema.json`
- Create: `runtime/schemas/observation.schema.json`
- Create: `runtime/schemas/rule.schema.json`
- Create: `tests/contracts.test.ts`

**Interfaces:**
- Produces: `CapabilityManifest`, `Evidence`, `Observation`, `Rule`, `validateContract(name: ContractName, value: unknown): ValidationResult`, and `detectCapabilities(probes: CapabilityProbes): CapabilityManifest`.

- [ ] **Step 1: Write failing contract tests**

```ts
assert.equal(validateContract("observation", { confidence: 0.9 }).ok, false);
assert.deepEqual(
  detectCapabilities({ pptxRead: true, pptxWrite: true, renderSlides: false, imageAnalysis: false, parallelAgents: false }),
  { pptxRead: true, pptxWrite: true, renderSlides: false, imageAnalysis: false, parallelAgents: false }
);
```

- [ ] **Step 2: Run the contract tests and verify expected failures**

Run: `npm test -- tests/contracts.test.ts`

Expected: FAIL because validation and capability detection are absent.

- [ ] **Step 3: Implement schemas and typed validators**

Require `source_type`, evidence locators, numeric confidence in `[0,1]`, `priority`, `coverage`, `missing_capabilities`, and `unknown_fields`. Make capability data declarative; do not probe or install software inside the detector.

- [ ] **Step 4: Verify contracts**

Run: `npm test -- tests/contracts.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/contracts runtime/src/capabilities runtime/schemas tests/contracts.test.ts
git commit -m "feat: add contracts and capability manifest"
```

### Task 3: Implement company-instance loading and local filesystem isolation

**Files:**
- Create: `runtime/src/instances/manifest.ts`
- Create: `runtime/src/instances/store.ts`
- Create: `runtime/schemas/instance.schema.json`
- Create: `instances/example-company/instance.yaml`
- Create: `tests/instance-store.test.ts`

**Interfaces:**
- Consumes: `validateContract`.
- Produces: `openInstance(root: string, companyId: string): Promise<InstanceStore>` and `InstanceStore.resolve(assetRef: InstanceAssetRef): string`.

- [ ] **Step 1: Write failing isolation tests**

```ts
await assert.rejects(() => openInstance(fixturesRoot, "../other-company"));
await assert.rejects(() => store.resolve("company-b:styles/default/profile.json"));
assert.match(await store.resolve("styles/default/profile.json"), /example-company/);
```

- [ ] **Step 2: Run the isolation tests and verify they fail**

Run: `npm test -- tests/instance-store.test.ts`

Expected: FAIL because no scoped loader exists.

- [ ] **Step 3: Implement a canonical-path instance store**

Load only a local root configured at process startup. Reject path traversal, foreign instance prefixes, missing manifests and references outside the canonical company root. Document that filesystem ACLs or separate roots are required for hard security boundaries; the runtime enforces defense-in-depth scoping.

- [ ] **Step 4: Verify isolation**

Run: `npm test -- tests/instance-store.test.ts`

Expected: PASS, including cross-instance rejection.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/instances runtime/schemas/instance.schema.json instances/example-company/instance.yaml tests/instance-store.test.ts
git commit -m "feat: isolate local company instances"
```

### Task 4: Add taxonomy, style profile, evidence and approval contracts

**Files:**
- Create: `runtime/src/contracts/taxonomy.ts`
- Create: `runtime/src/approvals/state-machine.ts`
- Create: `runtime/schemas/style-profile.schema.json`
- Create: `runtime/schemas/approval.schema.json`
- Create: `instances/example-company/taxonomy/business-types.json`
- Create: `instances/example-company/taxonomy/visual-styles.json`
- Create: `instances/example-company/taxonomy/layout-patterns.json`
- Create: `tests/taxonomy-approval.test.ts`

**Interfaces:**
- Produces: `proposeClassification(input: ClassificationProposal): ApprovalRequest`, `applyApproval(state: ApprovalState, decision: ApprovalDecision): ApprovalState`, and `StyleProfile`.

- [ ] **Step 1: Write failing protection tests**

```ts
assert.equal(applyApproval(candidate, { action: "approve" }).status, "approved");
assert.throws(() => applyApproval(approved, { action: "rename", newName: "x" }));
assert.deepEqual(beforeTaxonomy, afterCandidateProposal);
```

- [ ] **Step 2: Run the taxonomy tests and verify they fail**

Run: `npm test -- tests/taxonomy-approval.test.ts`

Expected: FAIL because candidates and protected taxonomies do not exist.

- [ ] **Step 3: Implement independent taxonomies and approval-only mutation**

Keep `business_type`, `visual_style`, and `layout_pattern` in separate files. Allow candidate styles and additive tags, but require an approved `ApprovalDecision` for formal publish, rename, merge, split or deprecation.

- [ ] **Step 4: Verify taxonomy behavior**

Run: `npm test -- tests/taxonomy-approval.test.ts`

Expected: PASS; unapproved proposals leave approved taxonomy untouched.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/contracts/taxonomy.ts runtime/src/approvals runtime/schemas instances/example-company/taxonomy tests/taxonomy-approval.test.ts
git commit -m "feat: protect taxonomy and approval state"
```

### Task 5: Define all nine observer contracts and normalized prompt resources

**Files:**
- Create: `runtime/src/observers/catalog.ts`
- Create: `runtime/src/observers/normalize.ts`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/style-classifier.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/typography.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/visual-style.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/layout.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/master-template.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/table.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/chart.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/visual-asset.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/observers/content.md`
- Create: `tests/observers.test.ts`

**Interfaces:**
- Produces: `OBSERVER_IDS`, `createObservationTask(id: ObserverId, input: ObservationInput): AgentTask`, and `normalizeObservation(result: unknown, context: ObservationContext): Observation`.

- [ ] **Step 1: Write failing observer completeness tests**

```ts
assert.deepEqual(OBSERVER_IDS, [
  "style-classifier", "typography", "visual-style", "layout", "master-template",
  "table", "chart", "visual-asset", "content"
]);
assert.equal(normalizeObservation(rawWithoutEvidence, context).ok, false);
```

- [ ] **Step 2: Run the observer tests and verify they fail**

Run: `npm test -- tests/observers.test.ts`

Expected: FAIL because the catalog and normalizer do not exist.

- [ ] **Step 3: Implement the catalog and one prompt reference per observer**

Each prompt must define scope, inputs, evidence requirements, allowed `UNKNOWN` output and prohibited inference. Every normalized result includes `coverage`, missing capabilities and unknown fields. The model adapter remains external to these resources.

- [ ] **Step 4: Verify observer contract completeness**

Run: `npm test -- tests/observers.test.ts`

Expected: PASS with exactly nine distinct observer IDs and valid normalized results.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/observers .cursor/skills/enterprise-ppt-multistyle/references/observers tests/observers.test.ts
git commit -m "feat: define nine PPT observation agents"
```

### Task 6: Orchestrate slide, deck and corpus observation with serial fallback

**Files:**
- Create: `runtime/src/orchestration/observe.ts`
- Create: `runtime/src/orchestration/audit.ts`
- Create: `runtime/src/orchestration/model-adapter.ts`
- Create: `tests/orchestration.test.ts`

**Interfaces:**
- Consumes: `CapabilityManifest`, `AgentTask`, and observer normalization.
- Produces: `observeDeck(request: ObservationRequest, adapter: ModelAdapter): Promise<ObservationRun>` and `auditRun(run: ObservationRun): FinalAudit`.

- [ ] **Step 1: Write failing execution-mode tests**

```ts
const run = await observeDeck(serialCapabilitiesRequest, recordingAdapter);
assert.deepEqual(recordingAdapter.calls.map(({ observerId }) => observerId), OBSERVER_IDS);
assert.equal(run.executionMode, "serial");
assert.equal(auditRun(run).unresolved.length, 0);
```

- [ ] **Step 2: Run orchestration tests and verify they fail**

Run: `npm test -- tests/orchestration.test.ts`

Expected: FAIL because the orchestrator does not exist.

- [ ] **Step 3: Implement slide/deck/corpus aggregation and final audit**

Use `ModelAdapter.run(task)` as the sole model boundary. Select bounded parallelism only when the manifest allows it; preserve deterministic result order. The audit must identify conflicts, absent required evidence, low confidence rules and candidate classifications.

- [ ] **Step 4: Verify serial and parallel modes**

Run: `npm test -- tests/orchestration.test.ts`

Expected: PASS; serial fallback invokes all nine observers once.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/orchestration tests/orchestration.test.ts
git commit -m "feat: orchestrate multi-agent PPT observation"
```

### Task 7: Implement scenario routing and approval-gated generation plans

**Files:**
- Create: `runtime/src/routing/router.ts`
- Create: `runtime/src/routing/scoring.ts`
- Create: `instances/example-company/scenarios/scenario-style-map.json`
- Create: `tests/router.test.ts`

**Interfaces:**
- Produces: `routeScenario(request: GenerationRequest, library: StyleLibrary): RoutingDecision` and `requireApprovedRoute(decision: RoutingDecision): ApprovedRoute`.

- [ ] **Step 1: Write failing route tests**

```ts
assert.equal(routeScenario(annualReport, library).selectedStyleRefs[0], "styles/business-formal");
assert.equal(routeScenario(ambiguousRequest, library).requires_confirmation, true);
assert.throws(() => requireApprovedRoute(routeScenario(ambiguousRequest, library)));
```

- [ ] **Step 2: Run route tests and verify expected failures**

Run: `npm test -- tests/router.test.ts`

Expected: FAIL because scoring and approval gates are absent.

- [ ] **Step 3: Implement explainable scoring and route gates**

Score business type, audience, department when known, delivery context, explicit tags and approved mappings. Return candidates, evidence and confidence; never synthesize a new formal style from the request.

- [ ] **Step 4: Verify routing**

Run: `npm test -- tests/router.test.ts`

Expected: PASS; ambiguous routes cannot become generation input.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/routing instances/example-company/scenarios tests/router.test.ts
git commit -m "feat: route scenarios to approved PPT styles"
```

### Task 8: Implement native editable-PPTX creation and adapter capability gates

**Files:**
- Create: `runtime/src/generation/adapter.ts`
- Create: `runtime/src/generation/native-create.ts`
- Create: `runtime/src/generation/page-plan.ts`
- Create: `tests/native-create.test.ts`

**Interfaces:**
- Consumes: `ApprovedRoute` and `PagePlan`.
- Produces: `GenerationAdapter.generate(input: GenerationInput): Promise<GenerationResult>` and `NativeCreateAdapter`.

- [ ] **Step 1: Write a failing editable-deck test**

```ts
const result = await new NativeCreateAdapter().generate(minimalApprovedInput);
assert.equal(result.mode, "native-create");
assert.equal(await fileExists(result.outputPath), true);
assert.equal(await countSlides(result.outputPath), 2);
```

- [ ] **Step 2: Run the generator test and verify it fails**

Run: `npm test -- tests/native-create.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement `NativeCreateAdapter` with PptxGenJS**

Create a new presentation per result, apply approved Token values and layouts from `PagePlan`, and write an editable `.pptx`. Refuse template-fill/existing-deck-edit when their adapter or necessary capabilities are unavailable. Keep the adapter interface independent of model provider.

- [ ] **Step 4: Verify native generation**

Run: `npm test -- tests/native-create.test.ts && npm run typecheck`

Expected: PASS; a newly generated deck exists with the expected slide count.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/generation tests/native-create.test.ts package.json
git commit -m "feat: generate editable PPTX from approved plans"
```

### Task 9: Add QA aggregation, safe repair policy and capability-aware outcomes

**Files:**
- Create: `runtime/src/qa/audit.ts`
- Create: `runtime/src/qa/repair.ts`
- Create: `runtime/src/qa/coverage.ts`
- Create: `instances/example-company/qa/repair-whitelist.json`
- Create: `tests/qa.test.ts`

**Interfaces:**
- Produces: `auditDeck(input: AuditInput): Promise<AuditReport>` and `applySafeRepairs(report: AuditReport, policy: RepairPolicy): RepairPlan`.

- [ ] **Step 1: Write failing QA/degradation tests**

```ts
const report = await auditDeck(noImageCapabilityInput);
assert.equal(report.visual.status, "not-run");
assert.match(report.coverage.gaps[0], /imageAnalysis/);
assert.equal(applySafeRepairs(semanticFindingReport, policy).actions.length, 0);
```

- [ ] **Step 2: Run QA tests and verify expected failures**

Run: `npm test -- tests/qa.test.ts`

Expected: FAIL because QA and repair policy do not exist.

- [ ] **Step 3: Implement structural QA, visual QA gates and repair whitelist**

Aggregate findings by severity. Run visual checks only when both rendering and image analysis are available. Permit only whitelist mechanical repairs; route semantic, classification, data meaning and style-selection changes to an approval request.

- [ ] **Step 4: Verify QA behavior**

Run: `npm test -- tests/qa.test.ts`

Expected: PASS; unavailable visual QA is explicitly incomplete, not passed.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/qa instances/example-company/qa tests/qa.test.ts
git commit -m "feat: add capability-aware PPT quality audit"
```

### Task 10: Provide the optional localhost review UI without creating a compatibility dependency

**Files:**
- Create: `runtime/src/ui/server.ts`
- Create: `runtime/public/index.html`
- Create: `runtime/public/app.js`
- Create: `tests/ui-api.test.ts`

**Interfaces:**
- Consumes: approval request/decision files and `InstanceStore`.
- Produces: `startReviewUi(options: ReviewUiOptions): Promise<ReviewUiServer>` exposing read-only review endpoints plus a local approval submission endpoint.

- [ ] **Step 1: Write failing local UI API tests**

```ts
const response = await getJson(`${server.url}/api/approvals/pending`);
assert.equal(response.items[0].companyId, "example-company");
assert.equal((await postJson(`${server.url}/api/approvals`, approvedDecision)).status, 201);
```

- [ ] **Step 2: Run UI API tests and verify they fail**

Run: `npm test -- tests/ui-api.test.ts`

Expected: FAIL because the server does not exist.

- [ ] **Step 3: Implement localhost-only UI over canonical files**

Bind only to loopback by default. Read/write the existing approval contracts; do not create a parallel database or a model-specific flow. The static page shows pending candidates, evidence, routing decisions and audit findings.

- [ ] **Step 4: Verify UI compatibility**

Run: `npm test -- tests/ui-api.test.ts`

Expected: PASS; decisions written through the endpoint are valid approval files consumable without the UI.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/ui runtime/public tests/ui-api.test.ts
git commit -m "feat: add local PPT review UI"
```

### Task 11: Add opt-in public-fixture provenance, end-to-end tests and final SKILL guidance

**Files:**
- Create: `scripts/fetch-public-fixture.ts`
- Create: `tests/e2e.test.ts`
- Create: `instances/example-company/tests/public-fixture.manifest.json`
- Modify: `.cursor/skills/enterprise-ppt-multistyle/SKILL.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/testing-and-release.md`

**Interfaces:**
- Consumes: all prior public contracts.
- Produces: `runFixtureWorkflow(options: FixtureWorkflowOptions): Promise<WorkflowReport>` and a provenance manifest with URL, retrieval date, SHA-256, purpose and use/license note.

- [ ] **Step 1: Write a failing end-to-end test with a local fixture**

```ts
const report = await runFixtureWorkflow(localFixtureOptions);
assert.equal(report.generatedDeck.status, "created");
assert.equal(report.audit.complete, false);
assert.match(report.audit.coverage.gaps.join("\n"), /imageAnalysis/);
```

- [ ] **Step 2: Run the end-to-end test and verify it fails**

Run: `npm test -- tests/e2e.test.ts`

Expected: FAIL until all workflow components are wired together.

- [ ] **Step 3: Implement explicit fixture acquisition and workflow wiring**

Require a user-supplied public URL and a confirmation flag to fetch a fixture; never acquire it during ordinary test execution. Store provenance but keep test fixtures outside enterprise evidence. Finish `SKILL.md` with learning, generation, QA, capability degradation, local instance and approval workflows.

- [ ] **Step 4: Verify the complete framework**

Run: `npm test && npm run typecheck && npm run ppt-skill -- validate-instance instances/example-company`

Expected: PASS. If no rendering/image adapter is installed, the end-to-end report must explicitly show incomplete visual coverage.

- [ ] **Step 5: Commit**

```bash
git add scripts tests/e2e.test.ts instances/example-company/tests .cursor/skills/enterprise-ppt-multistyle
git commit -m "test: verify enterprise PPT skill end-to-end workflow"
```

## Self-Review

- **Spec coverage:** Tasks 2–4 implement contracts, isolation, classification and version-safe approvals; Tasks 5–6 implement all agents and observation layers; Tasks 7–9 implement routing, editable deck generation and capability-aware QA; Task 10 provides optional compatible local review; Task 11 covers public samples, provenance and the full workflow.
- **Step scan:** Every task begins with a failing test, names exact exports and files, uses a single focused implementation step, and ends in targeted verification.
- **Type consistency:** `CapabilityManifest` is introduced in Task 2; `InstanceStore` in Task 3; `Observation`/`Rule` in Task 2; `ApprovedRoute` in Task 7; and all later tasks consume those names unchanged.
- **Review focus:** Each listed failure mode is assigned to the specified task's test.
- **Proportion:** The plan specifies contracts and tests rather than implementation bodies; detailed algorithms remain with the implementation tasks.
