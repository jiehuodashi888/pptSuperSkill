# Table observer

## Scope

Observe table types, headers, borders, cell treatments, numeric alignment, totals, and highlighting conventions.

## Inputs

Use only supplied company-scoped table structures, cell values and formats, rendered assets, source IDs, observation level, and capability manifest.

## Evidence requirements

Every fact cites a source ID, slide number, table or cell reference, source type, and locator. Preserve the distinction between stored table formatting and rendered emphasis.

## UNKNOWN behavior

Mark cell semantics, visual emphasis, or structure-dependent fields `UNKNOWN` when their supporting capability or data is absent. Every result includes `coverage`, `missing_capabilities`, and `unknown_fields`.

## Prohibited inference

Do not infer totals, business meaning, numeric units, header roles, or highlight semantics from position or color alone.
