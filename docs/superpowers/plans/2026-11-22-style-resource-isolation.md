# Style Resource Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce company- and style-scoped presentation resource access through a versioned resource catalog, default-deny resolver, protected production workflow, and SKILL guidance.

**Architecture:** Add a core resource package and an instance-owned resource catalog whose entries are immutable identities (`scope`, company/style ownership, version, hash, status and allowed purpose). Production code opens one company instance, creates a resource registry, routes only registered approved styles, resolves opaque resources, and derives output/cache paths from deployment roots. Existing low-level APIs remain test-only; no production path accepts an arbitrary template reference or directory.

**Tech Stack:** Node.js 20+, TypeScript, AJV JSON Schema validation, Node `fs/promises`, SHA-256, PptxGenJS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-22-style-resource-isolation-design.md`

## Global Constraints

- Preserve local-first operation; do not add a database, network service, account system, SSO, or external dependency.
- The only production resource ranges are `core`, `company`, and `style`; phase 1/2 reject `request` and `quarantine` for production resolution.
- Every production resource lookup validates exact identity, company, style import/export relationship, purpose, status, canonical path and SHA-256 before reading content.
- Core resources load only from `RuntimeDeploymentConfig.coreResourcesRoot`; an instance manifest cannot redirect that root.
- Company raw samples, original templates and evidence never become core resources through runtime APIs.
- `runProtectedWorkflow` is the sole production orchestration entry point; legacy route/generation/fixture APIs are documented and typed as low-level or test-only.
- Outputs and cache roots derive only from `RuntimeDeploymentConfig` and include company, style, resource-version-set hash and request ID.
- Keep honest capability reporting: resource access success never upgrades incomplete visual QA coverage.
- Continue using Node.js 20+ and current package scripts; no new package is required.

## Review Focus

- A same-company caller requests a private resource owned by another style: resolver must deny it before opening the resource path (Task 2).
- A catalog entry's file is swapped after approval: SHA-256 revalidation must deny it despite a valid path (Task 2).
- A caller supplies a forged route, bare `StyleLibrary`, template path or output directory: the production workflow must reject it and derive its own handles/roots (Tasks 3–4).
- A revoked company export or removed consumer import must immediately prevent a previously usable resource from resolving (Task 5).
- A fixture or quarantine resource must never cross into a protected generation request, even if its data structurally resembles an approved style (Tasks 4 and 7).

---

## Planned file structure

| Path | Responsibility |
| --- | --- |
| `runtime/schemas/resource-catalog.schema.json` | Catalog entry identity, scope, status, hash, path, purpose and export policy contract. |
| `runtime/schemas/style-manifest.schema.json` | Owned resources, imports, routing attributes and token override policy. |
| `runtime/schemas/resource-share-request.schema.json` | Company-internal sharing approval request; no cross-company publisher. |
| `runtime/src/resources/types.ts` | Shared resource identity, access context, opaque resolved-handle and deployment types. |
| `runtime/src/resources/registry.ts` | Instance/core catalog loading, schema validation and exact record lookup. |
| `runtime/src/resources/resolver.ts` | Default-deny policy, containment, hash verification and authentic handles. |
| `runtime/src/resources/style-library.ts` | Builds an approved routable library from registered manifests and mappings. |
| `runtime/src/workflow/protected.ts` | Sole production workflow and derived output/cache namespaces. |
| `runtime/src/approvals/resource-sharing.ts` | Company share/import change validation and canonical request handling. |
| `runtime/core-resources/core-catalog.json` | Empty/generic tracked core resource package manifest for development and tests. |
| `.cursor/skills/enterprise-ppt-multistyle/` | Concise execution rules plus a resource-isolation reference. |
| `tests/resources*.test.ts`, `tests/protected-*.test.ts` | Schema, resolver, routing, workflow, approval and migration coverage. |

### Task 1: Define and load resource catalogs

**Files:**
- Create: `runtime/schemas/resource-catalog.schema.json`
- Create: `runtime/schemas/style-manifest.schema.json`
- Create: `runtime/src/resources/types.ts`
- Create: `runtime/src/resources/registry.ts`
- Create: `runtime/core-resources/core-catalog.json`
- Modify: `runtime/schemas/instance.schema.json`
- Modify: `runtime/src/contracts/types.ts`
- Modify: `runtime/src/contracts/validate.ts`
- Test: `tests/resources-catalog.test.ts`

**Interfaces:**
- Produces `ResourceScope`, `ResourceKind`, `ResourcePurpose`, `ResourceRef`, `ResourceRecord`, `StyleManifest`, `RuntimeDeploymentConfig`, and `ResourceRegistry`.
- `openResourceRegistry(store: InstanceStore, config: Pick<RuntimeDeploymentConfig, "coreResourcesRoot">): Promise<ResourceRegistry>` returns frozen catalogs rooted in the current instance and fixed core root.
- Later tasks consume exact `ResourceRef` records from `ResourceRegistry`; no task constructs a resource from only a local path.

- [ ] **Step 1: Write failing catalog and schema tests**

Add tests for a valid approved company record, a valid style record, and failures for: unknown scope/purpose, missing `companyId` outside `core`, missing `styleId` for `style`, non-SemVer version, non-hex hash, absolute/traversing path, duplicate full resource identity, and a style manifest that imports a foreign company resource.

- [ ] **Step 2: Run the focused catalog tests to verify RED**

Run: `npm test -- tests/resources-catalog.test.ts`

Expected: FAIL because the resource schemas, contract names and registry exports do not exist.

- [ ] **Step 3: Implement schemas, frozen types and catalog loader**

Add the two JSON schemas and register their names in `ContractName`/`validateContract`. Extend `instance.schema.json` with optional `resource_catalog` and `resource_catalog_version` fields; retain `assets` only for legacy validation. Implement registry loading from `<instance>/resources/catalog.json`, style manifests named by cataloged style records, and `<coreResourcesRoot>/core-catalog.json`; reject a core catalog path provided by instance data.

- [ ] **Step 4: Run focused tests and type checking**

Run: `npm test -- tests/resources-catalog.test.ts; npm run typecheck`

Expected: focused tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add runtime/schemas runtime/src/resources/types.ts runtime/src/resources/registry.ts runtime/src/contracts runtime/core-resources tests/resources-catalog.test.ts
git commit -m "feat: add resource catalog contracts"
```

### Task 2: Implement default-deny resolution and authentic handles

**Files:**
- Create: `runtime/src/resources/resolver.ts`
- Modify: `runtime/src/instances/store.ts`
- Modify: `runtime/src/resources/registry.ts`
- Test: `tests/resource-resolver.test.ts`

**Interfaces:**
- Consumes `ResourceRegistry` and `ResourceRef` from Task 1 plus `InstanceStore.resolve` containment checks.
- Produces `resolveResource(registry, ref, context): Promise<ResolvedResource>` and `isAuthenticResolvedResource(value): value is ResolvedResource`.
- Later tasks may pass only authentic `ResolvedResource` handles to protected routing/generation preparation.

- [ ] **Step 1: Write failing resolver tests**

Cover: own approved style resource succeeds; a different style in the same company fails before file read; company resource needs matching catalog export and consumer `imports`; foreign company fails; non-approved and `quarantine` resources fail for `generate`; hash drift fails after replacing bytes; a catalog path behind a directory link fails; and `request` scope always fails in phase 1/2.

- [ ] **Step 2: Run focused resolver tests to verify RED**

Run: `npm test -- tests/resource-resolver.test.ts`

Expected: FAIL because `resolveResource` is absent.

- [ ] **Step 3: Implement access policy and hash verification**

Implement exact-record lookup, resource status/purpose checks, double-sided import/export authorization, `InstanceStore.resolve` containment, async SHA-256 verification and immutable handles recorded in a module-private `WeakSet`. Add the minimum `InstanceStore` helper required to resolve only registered relative paths; do not add arbitrary production path resolution.

- [ ] **Step 4: Run focused tests and the existing isolation suite**

Run: `npm test -- tests/resource-resolver.test.ts tests/instance-store.test.ts`

Expected: both suites pass, including existing company-root containment coverage.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/resources/resolver.ts runtime/src/resources/registry.ts runtime/src/instances/store.ts tests/resource-resolver.test.ts
git commit -m "feat: enforce style-scoped resource resolution"
```

### Task 3: Build registered style libraries and protected route selections

**Files:**
- Create: `runtime/src/resources/style-library.ts`
- Modify: `runtime/src/routing/router.ts`
- Modify: `runtime/src/generation/adapter.ts`
- Modify: `runtime/src/generation/page-plan.ts`
- Test: `tests/protected-routing.test.ts`
- Modify: `tests/router.test.ts`
- Modify: `tests/native-create.test.ts`

**Interfaces:**
- Consumes authentic resource handles and approved style manifests from Tasks 1–2.
- Produces `loadApprovedStyleLibrary(registry)`, `routeProtectedScenario(request, library)`, `requireProtectedRoute(selection)`, and `ResolvedStyleSelection` with company/style identity and registered resource refs.
- `prepareGenerationResources(selection, registry, context)` returns authentic approved Token/layout/template handles for Task 4.

- [ ] **Step 1: Write failing protected-routing tests**

Test that loading ignores candidate/deprecated styles and mappings, refuses mappings to a foreign/missing style, refuses a style whose registered template lacks `generate` purpose, and cannot create a protected selection from a caller-created object or legacy `StyleLibrary`.

- [ ] **Step 2: Run focused routing tests to verify RED**

Run: `npm test -- tests/protected-routing.test.ts`

Expected: FAIL because protected library and selection APIs do not exist.

- [ ] **Step 3: Implement protected library, selection and generation preparation**

Keep `routeScenario` as documented low-level/test-only behavior. Build the protected library only from cataloged approved style manifests and cataloged approved `scenarios/approved-mappings.json`; preserve existing scoring fields. Make the protected selection carry an opaque authenticity marker and pass resolved approved token/layout/template resources into a new protected generation preparation function. Reject bare `templateRefs`, fabricated routes and token/page-plan resources not bound to the selected style.

- [ ] **Step 4: Run focused and regression tests**

Run: `npm test -- tests/protected-routing.test.ts tests/router.test.ts tests/native-create.test.ts`

Expected: protected tests pass and legacy test-only behavior remains explicitly covered.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/resources/style-library.ts runtime/src/routing/router.ts runtime/src/generation tests/protected-routing.test.ts tests/router.test.ts tests/native-create.test.ts
git commit -m "feat: route only registered approved styles"
```

### Task 4: Add the protected production workflow and derived namespaces

**Files:**
- Create: `runtime/src/workflow/protected.ts`
- Modify: `runtime/src/workflow/fixture.ts`
- Modify: `runtime/src/index.ts`
- Modify: `runtime/src/qa/audit.ts`
- Test: `tests/protected-workflow.test.ts`
- Modify: `tests/e2e.test.ts`

**Interfaces:**
- Consumes `RuntimeDeploymentConfig`, `ResourceRegistry`, protected routing and prepared generation resources from Tasks 1–3.
- Produces `runProtectedWorkflow(input: ProtectedWorkflowInput, deployment: RuntimeDeploymentConfig): Promise<ProtectedWorkflowReport>`.
- The workflow derives paths as `<outputRoot>/<company>/<style>/<request>/` and `<cacheRoot>/<company>/<style>/<resourceVersionSetHash>/<request>/`; callers cannot supply final directories.

- [ ] **Step 1: Write failing production-workflow tests**

Test that the workflow rejects an invalid request ID, a caller-supplied output directory, a forged protected route, a resource from another company/style, and an output/cache directory link. Assert that a valid registered style generates only in the derived output root and that no render/image capability leaves visual coverage incomplete.

- [ ] **Step 2: Run focused workflow tests to verify RED**

Run: `npm test -- tests/protected-workflow.test.ts`

Expected: FAIL because the protected production workflow does not exist.

- [ ] **Step 3: Implement `runProtectedWorkflow`**

Validate `companyId` and `requestId`; open the instance/registry; create a protected style selection; derive canonical output and cache namespaces; resolve resources with `purpose: "generate"`; invoke only registered adapters; invoke QA with the derived deck path and resource-version-set audit data. Mark `runFixtureWorkflow` as test-only in its API documentation and prevent its report from being accepted by the new production workflow.

- [ ] **Step 4: Run focused, e2e and QA tests**

Run: `npm test -- tests/protected-workflow.test.ts tests/e2e.test.ts tests/qa.test.ts`

Expected: all pass; valid runs retain incomplete visual QA when capabilities are absent.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/workflow runtime/src/index.ts runtime/src/qa/audit.ts tests/protected-workflow.test.ts tests/e2e.test.ts
git commit -m "feat: add protected resource workflow"
```

### Task 5: Add company-share approvals and revocation checks

**Files:**
- Create: `runtime/schemas/resource-share-request.schema.json`
- Create: `runtime/src/approvals/resource-sharing.ts`
- Modify: `runtime/src/approvals/files.ts`
- Modify: `runtime/src/approvals/state-machine.ts`
- Test: `tests/resource-sharing.test.ts`

**Interfaces:**
- Consumes registered resource records, style imports and existing canonical local approval files.
- Produces `proposeResourceShare`, `validateApprovedResourceShare`, and `validateStyleImportChange`; these validate company-internal sharing records but never publish a core resource.
- Task 2 resolver consumes only catalog/manifest relationships validated by these functions.

- [ ] **Step 1: Write failing sharing tests**

Test that sharing rejects foreign company resources, private style resource exports without owner consent, absent consumer import, hash/version/purpose changes after approval, duplicate/stale decisions, and attempts to create a core resource or cross-company promotion request through local approval files.

- [ ] **Step 2: Run focused sharing tests to verify RED**

Run: `npm test -- tests/resource-sharing.test.ts`

Expected: FAIL because resource-sharing contracts and APIs do not exist.

- [ ] **Step 3: Implement company-only sharing contract**

Add a schema and canonical request/decision validation that bind company ID, source resource identity, approved consumer style IDs, purposes, version and hash. Keep cross-company promotion explicitly outside this API: validate and reject any `core` target or foreign company. Revalidate approval data whenever a catalog export or style import changes.

- [ ] **Step 4: Run focused approval regressions**

Run: `npm test -- tests/resource-sharing.test.ts tests/taxonomy-approval.test.ts tests/ui-api.test.ts`

Expected: resource sharing and existing approval/UI contracts pass.

- [ ] **Step 5: Commit**

```bash
git add runtime/schemas/resource-share-request.schema.json runtime/src/approvals tests/resource-sharing.test.ts
git commit -m "feat: govern company resource sharing"
```

### Task 6: Migrate the example instance and validate resource-aware packages

**Files:**
- Create: `instances/example-company/resources/catalog.json`
- Create: `instances/example-company/styles/default/manifest.json`
- Create: `instances/example-company/scenarios/approved-mappings.json`
- Modify: `instances/example-company/instance.yaml`
- Modify: `runtime/src/instances/validate.ts`
- Modify: `runtime/src/index.ts`
- Test: `tests/instance-store.test.ts`
- Test: `tests/resources-catalog.test.ts`

**Interfaces:**
- Consumes schemas/registry from Task 1 and protected routing requirements from Task 3.
- Produces an example instance that is resource-catalog opt-in and a `validate-instance` command that distinguishes legacy manifest containment from resource-catalog semantic validation.

- [ ] **Step 1: Write failing migration and CLI tests**

Test that a resource-catalog instance fails validation for an undeclared resource path, an absent style manifest, mismatched company/style identity, missing declared mapping resource, and a hash mismatch. Retain a test that a legacy instance is clearly reported as legacy rather than silently treated as resource-safe.

- [ ] **Step 2: Run focused migration tests to verify RED**

Run: `npm test -- tests/resources-catalog.test.ts tests/instance-store.test.ts`

Expected: FAIL because the example package and resource-aware validation are absent.

- [ ] **Step 3: Implement the example catalog and validation mode**

Create generic, non-enterprise example records with computed hashes. Update CLI output to include `resourceCatalog: "validated" | "legacy"` and reject invalid opt-in catalogs. Preserve existing `assets` validation only as legacy containment behavior.

- [ ] **Step 4: Run CLI and focused tests**

Run: `npm test -- tests/resources-catalog.test.ts tests/instance-store.test.ts; npm run ppt-skill -- validate-instance instances/example-company`

Expected: tests pass and CLI reports a valid resource-catalog instance.

- [ ] **Step 5: Commit**

```bash
git add instances/example-company runtime/src/instances/validate.ts runtime/src/index.ts tests/resources-catalog.test.ts tests/instance-store.test.ts
git commit -m "feat: validate resource-aware instances"
```

### Task 7: Update the PPT SKILL and validate it with skill-development scenarios

**Files:**
- Modify: `.cursor/skills/enterprise-ppt-multistyle/SKILL.md`
- Create: `.cursor/skills/enterprise-ppt-multistyle/references/resource-isolation.md`
- Create: `docs/superpowers/specs/2026-11-22-resource-isolation-skill-evals.md`
- Test: independent fresh-agent scenarios recorded outside the tracked product tree

**Interfaces:**
- Consumes the public `runProtectedWorkflow`, `ResourceRef` and company-share APIs from Tasks 1–6.
- Produces a concise skill entry point that routes resource-bound work to the new reference and prohibits unsupported sharing paths without duplicating runtime validation logic.

- [ ] **Step 1: Run RED skill scenarios without the updated resource guidance**

Use three fresh, isolated agents against realistic requests: reuse another style's attractive template; use a company-private asset in a different company; and promote a client template to common core under delivery pressure. Record the actual unsafe choices and rationalizations in the eval document; do not alter the Skill before this baseline is captured.

- [ ] **Step 2: Write the minimal resource-isolation skill guidance**

Keep `SKILL.md` limited to when to open the registry, use `runProtectedWorkflow`, refuse bare paths and treat cross-company promotion as an external release process. Put resolution order, scope table, company-share approval and failure reporting in `references/resource-isolation.md`. The reference must link to the actual TypeScript APIs and must not claim the skill alone enforces access control.

- [ ] **Step 3: Run the same scenarios with the updated skill to verify GREEN**

Record whether each agent selects a current-company approved resource, escalates ambiguity, and refuses cross-company/raw-resource reuse. Add only narrowly evidenced counters for any new rationalization.

- [ ] **Step 4: Validate the skill package and regression suite**

Run: `python C:/Users/WenXinran/.codex/skills/.system/skill-creator/scripts/quick_validate.py .cursor/skills/enterprise-ppt-multistyle; npm test; npm run typecheck`

Expected: skill validator reports valid frontmatter/no scaffold placeholders; full runtime suite and type check pass.

- [ ] **Step 5: Commit**

```bash
git add .cursor/skills/enterprise-ppt-multistyle docs/superpowers/specs/2026-11-22-resource-isolation-skill-evals.md
git commit -m "docs: guide protected style resources"
```

### Task 8: Final security regression and release documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `.cursor/skills/enterprise-ppt-multistyle/references/testing-and-release.md`
- Test: `tests/protected-workflow.test.ts`

**Interfaces:**
- Consumes all protected contracts and example package created by Tasks 1–7.
- Produces release-facing documentation that distinguishes application-level policy enforcement, deployment ACL requirements, and external core-resource promotion.

- [ ] **Step 1: Write failing documentation/release assertions**

Add a focused test or command-level assertion that a protected workflow reports company/style/resource-version/request namespacing and rejects a cross-company resource before creating an output deck.

- [ ] **Step 2: Run the assertion to verify RED**

Run: `npm test -- tests/protected-workflow.test.ts`

Expected: FAIL until release metadata/reporting is exposed.

- [ ] **Step 3: Implement release reporting and documentation**

Expose safe resource provenance identifiers—not file paths or bytes—in protected workflow reports. Document the resource scope model, default-deny behavior, ACL deployment requirement, legacy-instance limitation and external core-release boundary. Do not add actual enterprise data or an automated promotion publisher.

- [ ] **Step 4: Run full verification**

Run: `npm test; npm run typecheck; npm run ppt-skill -- validate-instance instances/example-company; git diff --check`

Expected: all tests pass, type check passes, example instance is valid, and diff check is empty.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/ARCHITECTURE.md .cursor/skills/enterprise-ppt-multistyle/references/testing-and-release.md tests/protected-workflow.test.ts
git commit -m "docs: release protected resource isolation"
```

## Plan self-review

- **Spec coverage:** Tasks 1–2 implement catalog identity, trust roots, default deny and hashes; Task 3 binds routing; Task 4 owns production roots/namespaces; Task 5 implements intra-company sharing while keeping promotion external; Task 6 migrates instance validation; Task 7 applies skill-development RED/GREEN validation; Task 8 documents and verifies release boundaries.
- **Type consistency:** `ResourceRegistry` is created in Task 1, used by the resolver in Task 2, style loader in Task 3 and protected workflow in Task 4. `RuntimeDeploymentConfig` is defined once in Task 1 and consumed by Tasks 2/4. `ResolvedResource` originates only in Task 2.
- **Review-focus coverage:** every stated failure class is pinned to Tasks 2–5 and 7; Task 8 repeats the cross-company boundary at release level.
- **Proportion:** the plan specifies interfaces, file ownership and observable tests without pre-writing implementation bodies.
