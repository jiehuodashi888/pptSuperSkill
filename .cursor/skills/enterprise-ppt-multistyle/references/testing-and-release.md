# Testing and release

## Local workflow

From the repository root, use Node 20 or newer and install locked dependencies with `npm ci`. Ordinary tests use local synthetic inputs and an in-memory HTTP response; no public fixture is acquired. The focused command is `node --import tsx --test tests/e2e.test.ts`. The package command `npm test -- tests/e2e.test.ts` also runs the existing test glob.

`runtime/src/workflow/fixture.ts` exports `runFixtureWorkflow(options: FixtureWorkflowOptions): Promise<WorkflowReport>`. Required options are `instancesRoot`, `companyId`, an absolute local `fixturePath`, absolute `outputDirectory`, new PPTX `fileName`, explicit `capabilities`, and a `modelAdapter`. Optional `qa` carries the public structural and visual audit adapters. It opens the instance, checks declared assets, observes the local fixture, audits observation consistency, routes approved test styles, creates a native deck and audits the resulting deck.

The local JSON fixture follows `LocalWorkflowFixture`: `sourceId`, optional `structuralFacts`, `request: GenerationRequest`, `library: StyleLibrary`, and `pagePlan: PagePlan`. It is synthetic integration data, not a PPTX parser or a way to import approvals. A downloaded binary cannot be passed directly as this JSON fixture; an authorized reader adapter must separately extract evidence. All workflow reports carry `classification: "test-only"`; nothing is published back into the instance.

The report contains capabilities, `observationRun`, `observationAudit`, `routing`, `generatedDeck` (including `status: "created"` and output path), and `audit`. `audit.complete` aliases `audit.coverage.complete`. Always inspect `audit.status` too: complete coverage can contain failing findings. A structurally valid generated file with no visual capabilities must remain incomplete with an explicit `imageAnalysis` gap. The shipped E2E structural inspector checks actual PPTX XML and admits that it has not evaluated enterprise rules.

## Optional public acquisition

Do not choose a public sample URL or download content during normal testing. Only acquire a fixture when the user has supplied the exact HTTP(S) URL and explicitly authorized acquisition. Record the intended testing purpose and the source's actual license/use note; consent is not proof of a license. There is no default URL, and redirects require a new explicitly supplied destination URL.

The command below is a template, not an instruction to acquire its placeholders:

```text
npm run ppt-skill -- fetch-public-fixture --url "<user-supplied-http(s)-URL>" --confirm --instance "<absolute-instance-directory>" --name "<fixture-basename>" --purpose "<test-purpose>" --license-note "<license-or-use-note>"
```

The equivalent standalone entrypoint is `node --import tsx scripts/fetch-public-fixture.ts` with the same arguments. Both URL and the literal `--confirm` flag are mandatory; purpose, license note, safe name and absolute instance path are also required. The command verifies the instance, rejects path links/junctions and existing output files, disables redirects, limits responses to 32 MiB and applies a 30-second transport timeout. Output is scoped to `<instance>/tests/public-fixtures/<name>.bin` and `<name>.manifest.json`. The binary extension deliberately makes no claim about file type.

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
