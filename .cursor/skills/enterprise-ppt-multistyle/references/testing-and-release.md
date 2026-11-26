# Testing and release

## Local workflow

From the repository root, use Node 20 or newer and install locked dependencies with `npm ci`. Ordinary tests use local synthetic inputs and an in-memory HTTP response; no public fixture is acquired. The focused command is `node --import tsx --test tests/e2e.test.ts`. The package command `npm test -- tests/e2e.test.ts` also runs the existing test glob.

`runtime/src/workflow/fixture.ts` exports `runFixtureWorkflow(options: FixtureWorkflowOptions): Promise<WorkflowReport>`. Required options are `instancesRoot`, `companyId`, an absolute local `fixturePath`, absolute `outputDirectory`, new PPTX `fileName`, explicit `capabilities`, and a `modelAdapter`. Optional `qa` carries the public structural and visual audit adapters. It opens the instance, checks declared assets, observes the local fixture, audits observation consistency, routes approved test styles, creates a native deck and audits the resulting deck.

The local JSON fixture follows `LocalWorkflowFixture`: `sourceId`, optional `structuralFacts`, `request: GenerationRequest`, `library: StyleLibrary`, and `pagePlan: PagePlan`. It is synthetic integration data, not a PPTX parser or a way to import approvals. Fixture paths are classified before any filesystem lookup: UNC/network and device namespace paths are rejected; Windows paths must specify a drive and cannot name DOS devices or alternate streams. The deployment still controls whether local drive letters or directories are backed by remote mounts. A downloaded binary cannot be passed directly as this JSON fixture; an authorized reader adapter must separately extract evidence. All workflow reports carry `classification: "test-only"`; nothing is published back into the instance.

The report contains capabilities, `observationRun`, `observationAudit`, `routing`, `generatedDeck` (including `status: "created"` and output path), and `audit`. `audit.complete` aliases `audit.coverage.complete`. Preserve `audit.status`: failing structural findings keep `failed` even when visual coverage is incomplete. With no failing findings, missing visual capabilities yield `incomplete` and an explicit `imageAnalysis` gap. Complete coverage can also contain failing findings. The shipped E2E structural inspector checks actual PPTX XML and admits that it has not evaluated enterprise rules.

## Protected production regression

Deploy through `runProtectedWorkflow(input, deployment)`. The focused isolation file is `tests/protected-workflow.test.ts`; use `node --import tsx --test tests/protected-workflow.test.ts` for that file alone. `npm test -- tests/protected-workflow.test.ts` also runs the package's full test glob. It verifies company/style/request output namespacing, company/style/resource-version-set-hash/request cache namespacing, and cross-company denial before either output or cache root is created.

Retain `report.resourceProvenance` as the safe release provenance record: company, style, request, resource-version-set hash and exact resource IDs/scopes/owners/versions/SHA-256 values. This immutable snapshot contains no resource paths or bytes. Full workflow reports include local output/cache paths; do not publish them wholesale to shared logs. Record QA status and gaps separately: resource authorization never proves structural or visual coverage, and the current protected entry has no registered structural/render/image adapters.

The default-deny model permits only approved registered `core`, `company` and `style` resources for formal route/generate/QA purposes. Core dependencies require explicit pinned imports. Company and foreign-style dependencies require matching export allow-lists and exact consumer imports within the same company. Reserved `request` and `quarantine` scopes are currently rejected for every purpose, including observation. Unknown identity, scope or purpose, stale version/hash, invalid status, missing import/export and path escape must fail without a raw-path or cross-company fallback.

The example instance opts into catalog validation and reports `resourceCatalog: "validated"` with `scope: "resource-catalog-and-declared-asset-containment"`. A legacy `assets` package can still report `valid: true` with `resourceCatalog: "legacy"`; this proves only compatibility/containment checks and does not authorize protected generation without a resource catalog. Caller-built fixture libraries and `classification: "test-only"` reports cannot enter production.

## Optional public acquisition

Do not choose a public sample URL or download content during normal testing. Only acquire a fixture when the user has supplied the exact HTTP(S) URL and explicitly authorized acquisition. Record the intended testing purpose and the source's actual license/use note; consent is not proof of a license. There is no default URL, and redirects require a new explicitly supplied destination URL.

The command below is a template, not an instruction to acquire its placeholders:

```text
npm run ppt-skill -- fetch-public-fixture --url "<user-supplied-http(s)-URL>" --confirm --instance "<absolute-instance-directory>" --name "<fixture-basename>" --purpose "<test-purpose>" --license-note "<license-or-use-note>"
```

The equivalent standalone entrypoint is `node --import tsx scripts/fetch-public-fixture.ts` with the same arguments. Both URL and the literal `--confirm` flag are mandatory; purpose, license note, safe name and absolute instance path are also required. Literal URL fragment delimiters are rejected, including a trailing empty `#`. The command verifies the instance, rejects path links/junctions and existing output files, disables redirects, limits responses to 32 MiB and applies a 30-second transport timeout. Output is scoped to `<instance>/tests/public-fixtures/<name>.bin` and `<name>.manifest.json`. The binary extension deliberately makes no claim about file type.

Each acquired manifest contains exactly:

- `url`: the explicitly supplied source URL.
- `retrieved_at`: UTC ISO retrieval timestamp.
- `sha256`: lowercase SHA-256 of the exact stored bytes.
- `purpose` and `license_use_note`: the supplied testing purpose and use provenance.
- `fixture_file`: the local binary basename.
- `classification`: `test-only`.

The checked-in `instances/example-company/tests/public-fixture.manifest.json` is a truthful `not-acquired` inventory with an empty fixture list, not fake acquisition provenance. Successful acquisition writes a separate manifest; it does not rewrite this inventory. Review acquired material before any redistribution, and keep downloaded bytes out of the core release. Do not promote public visual patterns to company MUST rules.

## Approval and UI checks

File-only and optional localhost UI clients share the canonical request/decision contract. Test stale hashes, foreign companies, duplicate decisions, request integrity and the issued-request approval gate. UI approval records do not publish rules or taxonomies. Persist routing/audit display records only within the selected instance, and close local servers after review.

## Release verification

Run each command and stop on failure:

```bash
npm test
npm run typecheck
npm run ppt-skill -- validate-instance instances/example-company
git diff --check
```

Record failures and platform skips, including any host restriction on file symlinks. Directory junction tests still verify containment on Windows. Inspect the generated PPTX as an editable package and retain an honest coverage report. If render/image adapters are installed, separately verify every slide and supported rule; if unavailable, record the incomplete visual coverage instead of claiming a fully reviewed deck.

Before distributing the core, check that company data, acquired fixtures, generated decks and credentials are excluded. Ship only reviewed generic example assets. The native adapter supports editable title/body text and notes; template-fill, existing-deck-edit, full PPTX reading, rendering, visual analysis and actual repair execution still require deployment adapters. Release notes must preserve these limits.

Deployment must put real company instances outside this repository, isolate their roots, outputs and caches with least-privilege ACLs (separate OS identities where required), and keep the core package read-only. Runtime checks enforce application policy; they do not protect against a malicious process sharing the deployment's OS permissions or authenticate reviewers. Test success is not evidence that deployment ACLs are configured.

Company sharing binds source identity, purpose set and consumers through local approval APIs, followed by validated catalog export/import maintenance; a decision alone grants no resource handle. Cross-company promotion is an external core repository/artifact release boundary requiring company-owner, data/legal and core-publisher review, sanitization/license records, rollback and a new independent generic resource ID/version/hash. Do not publish original company bytes, paths, links or renamed copies. This repository has no automated promotion publisher or external gate implementation; a local `approve` file is not core-release authority.
