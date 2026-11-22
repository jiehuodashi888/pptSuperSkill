# Final branch fixes

Addressed the four final whole-branch findings without changing generation, persistence, or approval state-machine behavior.

1. Model classification proposals must use `candidate`; self-asserted `approved`, `deprecated`, and `rejected` states fail output validation. Final observation audit treats every received classification as approval-required because its input contract provides no authenticated approval provenance. A directly constructed `approved` classification cannot make the audit complete.
2. Normalization validates model uncertainty before merging. Coverage is the minimum of model and capability coverage; unknown fields and missing capabilities are unioned with runtime gaps. Malformed or unbounded metadata fails normalization. Unknown fields are limited to 128 nonblank, control-free strings of at most 256 characters; capability names are restricted to the manifest vocabulary.
3. Observation orchestration captures one validated immutable request snapshot before any adapter call. Task creation, execution mode, concurrency, source IDs, company and level all derive from that snapshot. The existing data-only isolation helper is reused; request accessors are rejected. An asynchronous regression mutates the caller's company, level, sources and capabilities while an adapter is suspended and verifies both all tasks and the final report retain the original scope.
4. Observation conflict grouping includes claim/property identity. Added an optional validated `property` field, preserved through normalization, so font family and size can coexist on one element while differing values for the same property conflict. Legacy facts use a documented deterministic claim grammar, retaining the existing `Titles use 32pt` versus `Titles use 28pt` conflict. Conflicting reused observation and rule IDs remain detected.

`runtime/OBSERVATION-CONTRACT.md` documents the uncertainty bounds, request snapshot, classification approval boundary, explicit property format and legacy inference. Arbitrary prose without a recognizable claim grammar has no semantic contradiction inference; adapters should emit stable explicit properties and canonical value descriptions for reliable comparison.

## Verification

- TDD RED: all seven newly added regression tests failed against the original implementation for the intended behavioral reasons (inflated coverage, invalid uncertainty accepted, self-approved classifications accepted twice, mutated report scope, compatible facts conflated, and explicit property identity discarded).
- Focused GREEN: `node --import tsx --test tests/observers.test.ts tests/orchestration.test.ts` — 43 passed, 0 failed.
- Full suite: `npm test` — 170 tests, 169 passed, 0 failed, 1 skipped. The existing skip is `openInstance rejects a manifest symlinked outside the company root`, because file symlinks are not permitted on this Windows host; directory-junction tests pass.
- `npm run typecheck` — passed. The first typecheck caught a readonly descriptor deletion in the snapshot helper; the helper now uses descriptor destructuring and the repeated check passes.
- `git diff --check` — passed; only repository LF-to-CRLF normalization notices were emitted.

No external services, models or network acquisitions were used. No subagents were spawned.

## Review fix round 2: uncertainty data snapshots

- The model's uncertainty fields are now read once through own property descriptors before contract validation. Coverage accessors are rejected without invocation, preventing a getter from returning low coverage for one read and high coverage for another.
- Uncertainty arrays are copied by indexed own string descriptors into detached frozen arrays. Proxies, custom prototypes, symbol keys (including iterators), extra array behavior, accessor entries and sparse entries are rejected. Length limits are checked before descriptor traversal/copying. Validation and unioning consume only the snapshot, never the original model-provided iterator.
- Three new TDD regressions failed against the previous implementation: erasing iterators were accepted, changing coverage getters were consumed, and array entry getters were consumed. The passing regressions additionally check both uncertainty list fields, an iterator that throws if started (a safe stand-in for unbounded iteration), inherited iterator behavior, proxy traps and oversized sparse arrays. All invocation counters stay zero; normal plain arrays retain the existing successful coverage/union behavior.
- Focused tests: **46 passed, 0 failed**. Full suite after final edits: **173 tests, 172 passed, 0 failed, 1 existing Windows file-symlink skip**. Typecheck and diff checks pass. The only diff notices are Git's existing LF-to-CRLF normalization notices.
