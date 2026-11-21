# Task 11 implementation report

Implemented the local synthetic fixture workflow, explicitly authorized public-fixture acquisition, instance-validation CLI, and final skill/release guidance.

## Interfaces and scope

- `runtime/src/workflow/fixture.ts` exports `runFixtureWorkflow(options: FixtureWorkflowOptions): Promise<WorkflowReport>` and `LocalWorkflowFixture`. It composes the existing instance store, capability validation/detection, nine-observer orchestration and observation audit, approved scenario routing, authentic route gate, native generation and deck QA contracts. Reports retain observation failures, routing evidence, actual generated file metadata and capability gaps. It never promotes fixture observations into company rules.
- Workflow input is an explicitly local JSON test fixture with caller-resolved test style library and page plan plus injected model/QA adapters. It is not a PPTX reader or an approval import path. The generated deck has `status: created`; `audit.complete` aliases coverage completeness, while `audit.status` preserves failed/incomplete/passed semantics.
- `runtime/src/instances/validate.ts` checks manifest schema and canonical containment/existence of declared assets. CLI: `npm run ppt-skill -- validate-instance instances/example-company`. The result names this limited scope; the existing empty example profile remains illustrative rather than falsely certified as generation-ready.
- `scripts/fetch-public-fixture.ts` supports both the standalone entrypoint and `ppt-skill fetch-public-fixture`. It requires an explicit URL and literal `--confirm`, absolute instance directory, safe basename, purpose and license/use note. HTTP(S) only; credentials/fragments and redirects are rejected. Writes are scoped to the selected instance's `tests/public-fixtures`, reject symbolic links/junctions and existing targets, and use exclusive creation. Responses are bounded to 32 MiB and a 30-second transport timeout.
- Acquired manifests emit exactly URL, UTC retrieval time, SHA-256 of stored bytes, purpose, license/use note, local artifact basename and test-only classification. The checked-in manifest truthfully records `not-acquired` with an empty inventory. Acquisition writes per-fixture manifests; it does not rewrite that inventory. `.gitignore` excludes acquired fixture directories.
- Expanded SKILL and instance-package guidance and added testing-and-release reference. These cover universal core/company separation, independent taxonomies, evidence requirements, serial capability fallback, approval provenance, ambiguous routing, editable native output, honest QA downgrade, repair-planning limits, optional localhost UI/file parity and release verification.

## TDD and verification

- Wrote `tests/e2e.test.ts` before production modules. `npm test -- tests/e2e.test.ts` failed as expected on the missing workflow module; the existing suite otherwise passed apart from its pre-existing platform skip.
- Focused E2E: **7 passed, 0 failed**. Tests inspect generated PPTX slide XML, verify all nine observations and real routing, require incomplete visual coverage and honest structural-rule gaps, and prevent output on ambiguous routes.
- Acquisition tests use only injected in-memory `Response` values. They verify provenance bytes/hash, required consent, HTTP(S), safe paths, no overwrite, directory-junction rejection, redirect policy and HTTP failure behavior. CLI validation and negative acquisition calls run real subprocesses.
- Full `npm test`: **144 tests, 143 passed, 0 failed, 1 skipped**. Existing skip: `openInstance rejects a manifest symlinked outside the company root`, because file symlinks are not permitted on this Windows host. Directory junction checks passed.
- `npm run typecheck`: passed, including the newly added scripts directory.
- `npm run ppt-skill -- validate-instance instances/example-company`: passed; one declared asset validated.
- CLI help lists the new commands. Standalone acquisition with only `--confirm` exits 1 for missing explicit URL, as intended.
- `git diff --check`: passed (Git reports only the repository's LF-to-CRLF normalization notices).

## Limits and non-actions

No public content was downloaded, no external model invoked, and no enterprise evidence, taxonomy or approved style was changed. No renderer or image-analysis adapter is supplied by the core; visual coverage remains incomplete. The bundled workflow is a test harness around existing public contracts, not production ingestion. Native output remains editable title/body text plus notes. Approval APIs issue publish classification proposals and consume approve/reject decisions; they do not yet issue other taxonomy mutation requests or publish taxonomy files. Local path checks assume the established trusted-filesystem model; hostile concurrent filesystem changes require OS isolation.
