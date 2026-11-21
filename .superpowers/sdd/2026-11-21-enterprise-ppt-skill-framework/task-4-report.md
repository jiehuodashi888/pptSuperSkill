# Task 4 Report: Taxonomy, Style Profile, Evidence, and Approval Contracts

## Status

Implemented and committed as `38c9537` (`feat: protect taxonomy and approval state`).

## Changed Files

- `runtime/src/contracts/taxonomy.ts`: defines independent taxonomy dimensions, taxonomy entries, evidence-backed classification proposals, approval requests, formal taxonomy changes, and `StyleProfile`.
- `runtime/src/approvals/state-machine.ts`: permits candidate requests to become approved or rejected and rejects direct publish, rename, merge, split, or deprecate decisions that bypass an approval request.
- `runtime/schemas/style-profile.schema.json`: validates independently selected business type, visual style, and layout pattern fields.
- `runtime/schemas/approval.schema.json`: validates evidence-backed requests for publish, rename, merge, split, and deprecate changes.
- `instances/example-company/taxonomy/business-types.json`: provides generic business-purpose examples.
- `instances/example-company/taxonomy/visual-styles.json`: provides generic visual-style examples.
- `instances/example-company/taxonomy/layout-patterns.json`: provides generic layout-pattern examples.
- `tests/taxonomy-approval.test.ts`: protects approval transitions, direct-mutation rejection, proposal immutability, taxonomy independence, schemas, and example files.

## TDD Evidence

1. Initial RED: `npm test -- tests/taxonomy-approval.test.ts` exited 1 with `ERR_MODULE_NOT_FOUND` for `runtime/src/contracts/taxonomy.js`, proving the requested taxonomy and approval behavior did not exist.
2. Initial GREEN: the same command passed after the minimum contracts, state machine, schemas, and example files were added.
3. Contract-shape RED: after changing the protection test to the brief's exact `{ action: "rename", newName: "x" }` example, `npm run typecheck` exited 1 because `newName` was not yet in `ApprovalDecision`.
4. Contract-shape GREEN: after aligning the public type and narrowing the publish-change assertion, `npm run typecheck` and the focused test command both exited 0.

## Verification

- Focused: `npm test -- tests/taxonomy-approval.test.ts` — PASS, 27 passed, 0 failed, 1 Windows-only symlink test skipped. The package script runs all test files and appends the focused file.
- Full: `npm test` — PASS, 27 passed, 0 failed, 1 Windows-only symlink test skipped.
- Types: `npm run typecheck` — PASS.
- Patch hygiene: `git diff --check` — PASS.

## Contract Decisions

- Candidate classification is modeled as an evidence-backed approval request whose formal change is `publish`; proposal creation clones candidate tags and evidence rather than accepting an approved taxonomy to mutate.
- Rename, merge, split, and deprecate are representable as approval-request changes. `applyApproval` accepts only `approve` or `reject` as state transitions; passing a formal change action directly always throws.
- Approved and rejected requests are terminal, preventing a completed request from being silently reused for another decision.
- `business_type`, `visual_style`, and `layout_pattern` are separate fields and separate taxonomy documents. No field derives or constrains another.
- Example-company entries use generic presentation concepts only and contain no real company names, identifiers, metrics, or proprietary terminology.

## Concerns

- This task defines and protects approval state; applying an approved change to a persisted taxonomy belongs to a later persistence or routing task. The approved taxonomy documents are never mutated by this API.
