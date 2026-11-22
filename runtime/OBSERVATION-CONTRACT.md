# Observation boundary

`observeDeck` captures a validated, immutable request snapshot before invoking an adapter. Both tasks and report scope use that snapshot. Request fields must be plain data, and the capability manifest is required.

Model classification output is a proposal and must have `status: "candidate"`. Other lifecycle states are rejected. `auditRun` requires approval for every classification proposal, even if a caller supplies `approved` directly: this API accepts no authenticated approval provenance. Persisted approval transitions belong to the approval workflow.

Observation uncertainty is conservative. Supplied `coverage` must be finite and between zero and one; the result uses the minimum of that value and capability-derived coverage. `missing_capabilities` and `unknown_fields` are validated and unioned with capability-derived gaps. Missing optional metadata retains the capability defaults for legacy adapters. Unknown fields must be nonblank strings without control characters, at most 256 characters each and 128 entries in total. Capability lists contain only the five known capability names. Duplicate entries and malformed metadata are rejected.

## Claim identity for conflicts

Prefer a stable `property` on each observation, for example `font_family`, `font_size`, or `title.alignment`. Keys are lowercase identifiers (`[a-z][a-z0-9_.-]*`), at most 128 characters. Emit one value per property and target, using `fact` as its canonical value description. Distinct facts for the same category, property, and evidence target conflict; distinct properties do not. Use the same key and value wording consistently across observations. Conflicting payloads reusing an observation ID remain conflicts regardless of property.

For older observations without `property`, the audit deterministically parses `<claim>: <value>`, `<claim> = <value>`, `<claim> is <value>`, `<claim> are <value>`, and `<claim> use(s) <value>` (case insensitive). The claim text identifies the property. For typography's legacy `use(s)` form only, values starting with a number followed by `pt` or `px` identify font size; other values identify font family. Thus `Titles use 32pt` and `Titles use 28pt` conflict, but `Titles use Arial` and `Titles use 32pt` do not. Other typography attributes such as weight should use explicit properties or the `is` form. `Font family is Arial` and `Font size is 32pt` identify different claims.

Unstructured prose without this grammar is treated as its own claim; the audit does not infer semantic contradictions from arbitrary prose. Adapters should supply explicit properties for reliable conflict detection, especially for non-English text and synonymous phrasing. This check compares canonical descriptions; it does not perform semantic equivalence analysis.
