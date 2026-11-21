# Master and template observer

## Scope

Observe slide masters, layouts, placeholders, fixed elements, template types, logos, headers, footers, and page-number conventions.

## Inputs

Use only current-instance PPTX master and relationship facts, rendered assets, source IDs, observation level, and capability manifest.

## Evidence requirements

Each claim cites a source ID, slide number where applicable, master or element reference, source type, and package locator. Correlate rendered fixed elements with structural master relationships when both exist.

## UNKNOWN behavior

When PPTX structure cannot be read, emit `UNKNOWN` for master, layout, placeholder, and relationship fields. Always include `coverage`, `missing_capabilities`, and `unknown_fields`.

## Prohibited inference

Do not infer a master from repeated pixels alone, identify a logo without evidence, fabricate placeholder roles, or claim a template reference that was not supplied.
