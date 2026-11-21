# Instance package

An instance package is supplied by the user or an authorized local deployment. Keep it separate from the framework runtime and do not commit confidential material to the framework repository.

The universal core is the versioned runtime, schemas and skill instructions. A company package lives under a selected instances root and has a lowercase company ID. Open it with `openInstance(root, companyId)`. Its `instance.yaml` uses the JSON subset of YAML: `company_id`, `core_version`, `assets`, and optional `policy`. Executable YAML features are not supported.

`assets` lists existing relative references. `InstanceStore.resolve(ref)` validates both lexical and canonical containment and rejects cross-company prefixes and traversal. Do not use it to invent missing output paths. Filesystem checks are defense in depth; hostile concurrent filesystem mutation requires OS-level separation or permissions.

Typical local directories hold `taxonomy/`, `styles/`, `scenarios/`, templates/assets, source evidence, `qa/`, `approvals/` and `review/`. Keep business types, visual styles and layout patterns in separate taxonomies. Approved style selection and page-plan values come from reviewed instance assets; the example package has generic illustrative mappings and an empty placeholder profile, not a complete production style library.

Run `npm run ppt-skill -- validate-instance <instance-directory>` to validate the manifest and resolve every declared asset. A successful result certifies only this package boundary. It does not recursively validate every JSON file, compare core versions for compatibility, approve assets, or check semantic readiness. Schema and application validation still apply when consumers load rules, observations, profiles and decisions.

Canonical approval files are `approvals/requests/<id>.json` and `approvals/decisions/<id>.json`. Decisions contain exactly `companyId`, `request_id`, `request_hash`, and `decision` (`{ "action": "approve" }` or `{ "action": "reject", "reason": "..." }`). Use `listPendingApprovals`, `submitApprovalDecision` and `readApprovalDecision`; then `consumeApprovalDecision` with the genuine issued request. A persisted JSON request alone cannot recreate process-local approval provenance.

Optional UI records at `review/routing.json` and `review/audit.json` are display data, not trusted approval handles. Public acquisitions belong only in `tests/public-fixtures/`; do not declare them as enterprise evidence or blend their rules into approved styles.
