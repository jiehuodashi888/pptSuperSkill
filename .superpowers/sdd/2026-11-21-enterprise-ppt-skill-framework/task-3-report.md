# Task 3 Report: Company Instance Loading and Filesystem Isolation

## Status

Implemented and committed as `a1c2e2d` (`feat: isolate local company instances`).

## Changed Files

- `runtime/src/instances/manifest.ts`: loads JSON-compatible YAML manifests and validates them through the existing `validateContract` API.
- `runtime/src/instances/store.ts`: opens one company-scoped instance and resolves only lexically and canonically contained asset references.
- `runtime/schemas/instance.schema.json`: defines the instance manifest contract.
- `runtime/src/contracts/types.ts`: adds `instance` to the existing contract-name union.
- `runtime/src/contracts/validate.ts`: registers the instance schema with the shared validator.
- `instances/example-company/instance.yaml`: adds a non-proprietary example instance manifest.
- `tests/instance-store.test.ts`: covers traversal, foreign prefixes, canonical link escapes, missing/invalid/mismatched manifests, directory aliases, and valid scoped resolution.

## TDD Evidence

1. Initial RED: `npm test -- tests/instance-store.test.ts` exited 1 with `ERR_MODULE_NOT_FOUND` for `runtime/src/instances/store.js`, confirming the scoped loader was absent.
2. Initial GREEN: the same command passed all original and new tests after the minimum implementation.
3. Self-review RED: a new company-directory junction-alias test failed with `Missing expected rejection`, proving a canonical cross-instance alias remained possible.
4. Self-review GREEN: after requiring the canonical company path to map exactly to the requested company ID, the focused command passed 19/19 tests in the command's combined run.

## Verification

- Focused: `npm test -- tests/instance-store.test.ts` — PASS, 19/19 tests, 0 failures. The package script includes all test files and appends the focused file.
- Full: `npm test` — PASS, 19/19 tests, 0 failures.
- Types: `npm run typecheck` — PASS.
- Patch hygiene: `git diff --check` — PASS.

## Self-Review

- Every request is bound to a validated lowercase company ID and a manifest whose `company_id` matches it.
- Both lexical traversal and canonical traversal through existing links are rejected.
- A company directory cannot alias a different path, even when the target remains under the configured instances root.
- Foreign instance prefixes are rejected; unprefixed references remain scoped to the opened store.
- The implementation contains no company-specific or proprietary values; those remain in the example instance package.
- The store documentation explicitly distinguishes defense-in-depth path scoping from hard isolation through OS ACLs, separate roots, or separate OS identities.
- No taxonomy, observer, routing, UI, or later-task behavior was added.

## Concerns

- `instance.yaml` is intentionally restricted to JSON syntax, which is a valid YAML subset. Supporting broader YAML syntax later would require a dedicated safe parser dependency and corresponding contract tests.
- Path validation limits accidental and application-level cross-instance access, but cannot replace OS permissions when the process identity can read multiple company roots.

## Corrective Patch — Round 1

### Root Cause and Changes

- `loadInstanceManifest` previously read `instance.yaml` without canonicalizing it, so a file symlink could redirect loading to a valid manifest outside the selected company root. It now requires both the company root and manifest to exist canonically and rejects a canonical manifest path outside that root before reading.
- `InstanceStore.resolve` previously reconstructed destinations from the nearest existing ancestor. A dangling directory junction was therefore treated like ordinary missing path components and could later expose an outside target. Resolution now requires the complete asset path to exist and canonicalize successfully; unresolved aliases and other missing components are invalid.
- The example company's declared profile asset now exists so successful resolution still exercises a real canonical file.
- Focused regressions cover an externally symlinked manifest and a directory junction whose outside target is initially absent and later materialized. The latter asserts rejection in both states.

### Verification Commands and Results

- `npm test -- tests/instance-store.test.ts` — PASS: 22 tests discovered by the package command, 21 passed, 0 failed, 1 skipped. The skip is the external-manifest file-symlink test because this Windows host returned `EPERM`; the dangling-junction regression executed and passed.
- `npm test` — PASS: 22 tests, 21 passed, 0 failed, 1 skipped for the same Windows file-symlink privilege limitation.
- `npm run typecheck` — PASS (`tsc --noEmit`).
- `git diff --check` — PASS.
