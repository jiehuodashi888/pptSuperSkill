---
name: enterprise-ppt-multistyle
description: Use when creating, reviewing, or improving editable enterprise presentations with local-first, model-agnostic workflows.
---

# Enterprise PPT Multistyle

Use this local, model-independent workflow to learn presentation conventions, create editable decks, and report QA coverage. The universal core contains contracts, observers, routing, generation and QA logic. Company instances contain their own approved rules, taxonomies, templates, assets and evidence. Never embed company values, confidential source slides or customer-specific classifications into this skill or the shared runtime.

## Select the instance and capabilities

Read [instance package guidance](references/instance-package.md). Select the company explicitly and use `openInstance(root, companyId)` plus `InstanceStore.resolve` for existing assets. Do not reuse another company's evidence or resolve arbitrary cross-instance paths. Validate the package before work:

```bash
npm run ppt-skill -- validate-instance instances/example-company
```

This command checks the manifest and declared asset existence/containment. It does not certify brand compliance, approve a style, or establish that illustrative example data is production-ready.

Supply verified capability probes to `detectCapabilities`: `pptxRead`, `pptxWrite`, `renderSlides`, `imageAnalysis`, `parallelAgents`. Availability is deployment-specific; the core does not discover installed applications or provide a model, renderer or visual-analysis service. Never infer capability from an adapter's name. Missing parallel agents means serial execution. Missing read/render/image capabilities must remain visible as missing capabilities, unknown fields and coverage gaps. Never describe structural inspection as visual inspection.

## Learn from authorized sources

Use `observeDeck(request, modelAdapter)` at slide, deck or corpus scope. Slide scope requires an exact slide number and document locator. The adapter receives tasks for all nine observers; execute the same tasks serially when parallel capability is unavailable. Consult the applicable observer references before supplying adapter results:

- [Typography](references/observers/typography.md), [layout](references/observers/layout.md), [visual style](references/observers/visual-style.md)
- [Content](references/observers/content.md), [charts](references/observers/chart.md), [tables](references/observers/table.md)
- [Master/template](references/observers/master-template.md), [visual assets](references/observers/visual-asset.md), [style classification](references/observers/style-classifier.md)

Every observation and proposed rule needs locatable source evidence. Keep observed values, frequency, confidence, exceptions and priority (`MUST`, `SHOULD`, `MAY`, `CONDITIONAL`, `UNKNOWN`) separate. One sample is not sufficient to assert a universal mandatory rule. Run `auditRun` over all observer outputs; retain failures, conflicting evidence, missing evidence, low-confidence rules and candidate classifications. Its `complete` flag describes observation consistency, not visual QA coverage.

Business type, visual style and layout pattern are independent taxonomy dimensions. Additive tags can describe evidence without publishing a formal category. Publish, rename, merge, split and deprecate operations require approved requests. Use `proposeClassification` to issue a publish candidate and apply its explicit decision with `applyApproval`. The current runtime does not issue other taxonomy-change requests or persist taxonomy mutations; leave those changes pending for a deployment workflow that supports them. Never manufacture an approved handle or treat a JSON status string as approval provenance.

## Route and generate

Collect business purpose, audience, department, delivery context and explicit tags. Use `routeScenario` against approved company styles and mappings; retain scored candidates and the evidence behind selection. If it requires confirmation, surface the ambiguity and resolve it through the approved instance workflow before rerouting. Do not silently invent a style or bypass `requireApprovedRoute`.

Resolve the selected approved tokens and layouts into a `PagePlan`. Pass the authentic route, capabilities, absolute local output directory and a new PPTX basename to `generatePresentation`. The bundled `NativeCreateAdapter` produces editable title/body text and optional notes. It does not implement arbitrary charts, tables, asset reconstruction, template filling or editing existing decks. Those modes require their own adapter and capabilities; an unavailable mode must fail explicitly. Output creation never overwrites an existing deck.

## Audit and repair

Run `auditDeck` on the actual generated deck with the expected slide count. A structural adapter must inspect deck bytes; validating only the page plan is insufficient. Visual QA needs both rendered slides and image analysis, including full slide coverage and explicit unsupported-rule gaps. No findings does not mean a complete audit. Deliver phase statuses, severity, evidence, coverage and outstanding gaps alongside the PPTX.

Preserve the returned `audit.status`. With no renderer/image adapter, report incomplete visual coverage and the `renderSlides`/`imageAnalysis` gaps separately. Structural error or critical findings keep the overall status `failed`, even while visual coverage is incomplete; never change that failure to `incomplete`. Without failing findings, missing coverage yields `incomplete`. Do not claim visual approval or fabricate screenshots. A check can also fail with complete coverage: `coverage.complete` is not the pass/fail result.

`applySafeRepairs` only produces a repair plan. Its automatic actions must exactly match an approved whitelist and are limited to supported mechanical text insets or paragraph spacing. Content, numbers, data meaning, classification, route and style changes require review. An execution adapter and a fresh audit are needed after actual document edits; the core does not execute the repair plan.

## Optional local review

Use `startReviewUi({ store })` to start the optional loopback-only review UI; retain the returned server and call `close()` when finished. This is a Node API, not a CLI command. The UI shows pending approvals, evidence, routing and audit records without model calls. Approve/reject uses the same canonical decision files as file-only clients. Decisions bind company, request ID and request hash, and must be consumed using the original issued request. The UI never directly publishes taxonomy or generates a deck.

Use [testing and release guidance](references/testing-and-release.md) for local fixtures, public-fixture consent/provenance, exact API boundaries and release checks. Ordinary tests never download public slides. Public samples remain test data and must never become company evidence or rules by implication.
