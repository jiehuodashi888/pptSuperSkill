# Resource isolation

This guidance directs agents to runtime checks; Markdown does not enforce access control. Runtime checks assume trusted deployment configuration and controlled local files. They do not authenticate people or protect against a malicious OS peer. Never copy another company's bytes, rename a resource, or substitute a raw path to work around a failed check.

## Open and resolve

Select the company explicitly. For inspection or sharing, use [`openInstance`](../../../../runtime/src/instances/store.ts), then [`openResourceRegistry(store, { coreResourcesRoot })`](../../../../runtime/src/resources/registry.ts) with the deployment's trusted core root. The registry loads `resources/catalog.json`, `core-catalog.json` and cataloged style manifests; directory scans and legacy `assets` are not an approved style library.

Use [`ResourceRef`](../../../../runtime/src/resources/types.ts): exact `resourceId`, `scope`, `companyId`/`styleId` where required, `version` and `sha256`. A name, path, copied JSON object or `status: "approved"` alone is not a resource handle. Read authorized bytes through [`resolveResource(registry, ref, context)`](../../../../runtime/src/resources/resolver.ts), with current `companyId`, consumer `styleId`, applicable `requestId` and the actual `purpose`. Do not reimplement its checks in a caller.

The resolver checks reference format and access context, company identity, exact catalog identity, scope/status/purpose, ownership or matching export/import, then canonical containment and the file hash. It returns a process-local authentic handle. Formal `route`, `generate` and `qa` uses require approved records. Missing or mismatched identities fail; there is no fallback to a similar name, another version, a different company or an arbitrary file.

| Scope | Supported access |
| --- | --- |
| `core` | Published generic resources. A consuming style pins an exact import; framework use without a style still checks purpose/status. |
| `company` | Current company only; consumer style must have an exact import and appear in the resource export allow-list. |
| `style` | Current company's owning style and declared ownership, or same-company sharing with matching export and exact consumer import. The cataloged owner manifest itself need not list itself. |
| `request` | Reserved; rejected by the current resolver for every purpose. |
| `quarantine` | Reserved; rejected by the current resolver for every purpose, including observation. |

Token composition in [`buildProtectedPagePlan`](../../../../runtime/src/generation/page-plan.ts) follows core, explicitly imported company, style, then permitted request overrides. This is composition of already-authorized resources, not a search/fallback order. A changed token value or request override needs the selected style's allowed key and must not be forbidden. Request token overrides do not enable `request` scope resources.

## Protected production

Call [`runProtectedWorkflow(input, deployment)`](../../../../runtime/src/workflow/protected.ts), also exported from [`runtime/src/index.ts`](../../../../runtime/src/index.ts). Its input is `companyId`, a new `requestId`, business `request`, slide `slides`, verified `capabilities`, and optional `tokenOverrides`. The trusted deployment supplies `instancesRoot`, `coreResourcesRoot`, `outputRoot` and `cacheRoot`. Resource paths, caller-built libraries/routes, final output directories, arbitrary QA paths and fixture reports are not input fields.

Internally, [`loadApprovedStyleLibrary`](../../../../runtime/src/resources/style-library.ts) and [`routeProtectedScenario`/`requireProtectedRoute`](../../../../runtime/src/routing/router.ts) select approved registered resources. If routing needs confirmation, report the ambiguity and resolve business facts or approved instance mappings before rerunning; never fabricate a route. The workflow derives output under company/style/request and cache under company/style/resource-version-set-hash/request. A verified template reference does not mean template filling is implemented: production currently uses native editable title/body text and notes.

Low-level generation, audit and fixture APIs remain useful for tests; they cannot substitute for the protected production entry. The current production workflow has no registered structural, render or image adapters. Preserve its reported audit gaps even if capability flags are true. Resource access success is not visual QA approval.

## Same-company sharing

Use the APIs in [`approvals/resource-sharing.ts`](../../../../runtime/src/approvals/resource-sharing.ts), together with [`approvals/files.ts`](../../../../runtime/src/approvals/files.ts):

1. Issue `proposeResourceShare(registry, proposal)` for an approved current-company source and approved same-company consumer styles. Bind the exact source reference, complete purpose set, consumers, license and rollback notes, and proposer. A style source also requires matching owner consent. `targetScope` is `company`; the source keeps its identity and scope.
2. Persist the issued proposal as the canonical request under `approvals/requests/<id>.json`. File clients and the optional review UI submit approve/reject with `submitApprovalDecision`; decisions bind company, request ID and request hash. Read with `readApprovalDecision` and consume using `consumeApprovalDecision` with the genuine issued request. Do not invent consent or an approval decision.
3. An authorized instance maintenance workflow must apply the reviewed export allow-list and exact consumer imports. These APIs do not persist catalog/manifest changes. Before saving an import change, call `validateStyleImportChange(registry, proposedManifest, approvalRequestIds)`; after the declared state is present, call `validateApprovedResourceShare(registry, requestId)`. These functions reload live declarations and decisions and reject missing, changed or revoked relationships and source bytes. Reopen the registry before subsequent production use.

A decision alone grants no resolver handle. The resolver checks current catalog export/import declarations, not the local approval history; deployment maintenance must use the approval validation APIs to govern changes. Changed source identity, purposes or consumer sets require matching fresh review. Local consent and decision files record intent but do not verify a human's identity. Generic permission, a familiar company name or a deadline does not replace this workflow.

## Core promotion is external

Local company-share APIs cannot target core, add new core imports, or share with another company. Core promotion belongs to an external repository/artifact release process with owner, data/legal and core-publisher review, sanitization and license records, rollback planning, and a new independent generic artifact with its own ID/version/hash. Original company paths, links, raw bytes and merely renamed client resources are not release artifacts. This repository does not implement that release gate or verify those reviewers' identities. Keep delivery on current-company approved resources while a separate release is pending; a local `approve` file cannot make a client template public core.

## Failure reporting

Stop the affected operation on missing catalogs, unresolved routing, invalid scope/purpose, missing export/import, stale approvals or hash/containment errors. Report the failed phase, current company/style/request identifiers, non-sensitive resource identity where appropriate, reason, and the supported next action (current approved resource, same-company review, or external release). Do not log confidential slide text, images or raw enterprise paths into shared reports. Preserve audit status and coverage gaps separately from resource success; never claim completion from a successful registry open alone.
