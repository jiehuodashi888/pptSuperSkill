# Repository Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a Chinese quick-start README and a separate bilingual architecture reference that accurately describe the Enterprise PPT Skill framework.

**Architecture:** Keep the root README short and task-oriented: it links readers to exact installation, validation, example-instance and documentation entry points. Put the full core/instance architecture and operational boundaries in `docs/ARCHITECTURE.md`, with the English section mirroring the Chinese technical meaning.

**Tech Stack:** Markdown, Node.js 20+, npm scripts already defined in `package.json`.

**Spec:** `docs/superpowers/specs/2026-11-22-repository-documentation-design.md`

## Global Constraints

- README is Chinese and prioritizes first-time setup; architecture detail belongs in `docs/ARCHITECTURE.md`.
- `docs/ARCHITECTURE.md` contains both Chinese and English technical reference sections.
- State only current, implemented behavior; `template-fill`, `existing-deck-edit`, cloud multi-tenancy and live enterprise-sample learning remain future extension boundaries.
- Installation and verification commands must match `package.json`: `npm ci`, `npm test`, `npm run typecheck`, and `npm run ppt-skill -- validate-instance instances/example-company`.
- Require Node.js 20 or newer and preserve the local-first, company-instance isolation boundary.

## Review Focus

- A reader with only Node.js 20+ can copy the README commands in order without a missing prerequisite.
- Readers do not mistake structural validation or incomplete capability coverage for completed visual QA.
- A company instance is clearly distinct from the shared runtime, so company templates and evidence are not presented as shared assets.
- The bilingual architecture document does not claim a model, renderer, image analyzer, or PPTX adapter exists when it is deployment-provided.
- Root documentation links resolve to files present in the repository.

---

### Task 1: Create the Chinese quick-start README

**Files:**
- Create: `README.md`
- Reference: `package.json`
- Reference: `.cursor/skills/enterprise-ppt-multistyle/SKILL.md`

**Interfaces:**
- Consumes: the exact npm scripts and implemented-boundary language from the existing skill.
- Produces: a repository-homepage entry point that links to `docs/ARCHITECTURE.md`, the existing detailed design and the skill instructions.

- [ ] **Step 1: Write the documentation acceptance checklist**

Record checks that `README.md` has Chinese quick-start commands for install, tests, type checking and `example-company` validation; describes company-instance isolation and safe capability degradation; and links to existing documentation paths.

- [ ] **Step 2: Verify the checklist fails before documentation exists**

Run: `Test-Path README.md`

Expected: `False`.

- [ ] **Step 3: Create `README.md`**

Use sections for project positioning, current abilities and boundaries, repository layout, prerequisites and installation, minimal verification, example instance, enterprise instantiation, documentation links, and security/data-isolation guidance. Use the four exact commands in Global Constraints and never state that optional adapters are bundled.

- [ ] **Step 4: Verify README commands and links**

Run: `rg -n "npm ci|npm test|npm run typecheck|validate-instance|docs/ARCHITECTURE.md" README.md`

Expected: one or more relevant matches for every required command and architecture link.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add Chinese quick-start README"
```

### Task 2: Create the bilingual architecture reference

**Files:**
- Create: `docs/ARCHITECTURE.md`
- Reference: `docs/superpowers/specs/2026-11-21-enterprise-ppt-skill-framework-design.md`
- Reference: `runtime/OBSERVATION-CONTRACT.md`

**Interfaces:**
- Consumes: the design's core/instance separation, nine-observer workflow, capability matrix and approval boundary.
- Produces: a stable architecture reference linked by `README.md`, with `## 中文` and `## English` top-level language sections.

- [ ] **Step 1: Write the documentation acceptance checklist**

Record checks for Chinese and English language entry sections; coverage of core/instance isolation, the nine observers, capability-aware degradation, route/generation/QA boundaries, and local review/approval behavior.

- [ ] **Step 2: Verify the checklist fails before the reference exists**

Run: `Test-Path docs/ARCHITECTURE.md`

Expected: `False`.

- [ ] **Step 3: Create `docs/ARCHITECTURE.md`**

Describe the implemented contracts and workflows concisely in Chinese, then supply an English technical equivalent. Mark optional or adapter-provided capabilities explicitly. Link to the detailed design and observer contract instead of duplicating their full content.

- [ ] **Step 4: Verify language sections, required concepts and repository links**

Run: `rg -n "^## 中文|^## English|九个观察员|nine observers|OBSERVATION-CONTRACT|enterprise-ppt-skill-framework-design" docs/ARCHITECTURE.md`

Expected: matches for each language section, all required concepts and both linked sources.

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: add bilingual architecture reference"
```

### Task 3: Validate repository documentation as a release surface

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: the two documentation entry points produced by Tasks 1 and 2.
- Produces: a documentation set whose commands and internal links match the checked-in project.

- [ ] **Step 1: Check all local Markdown destinations linked by README**

Run a short PowerShell check that finds relative `.md` link targets in `README.md` and verifies each target exists under the repository root.

- [ ] **Step 2: Correct broken links or inaccurate command text**

Only adjust the documentation line that caused the failed check; do not alter runtime code or package scripts.

- [ ] **Step 3: Run project verification**

Run: `npm run typecheck; npm run ppt-skill -- validate-instance instances/example-company; git diff --check`

Expected: the type check exits successfully, the instance command reports `"valid": true`, and `git diff --check` has no output.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs: verify repository entry documentation"
```
