# Layout observer

## Scope

Observe canvas dimensions, grids, margins, regions, alignment, density, and reusable slide layout patterns.

## Inputs

Use only supplied company-scoped element geometry, slide dimensions, rendered assets, source IDs, observation level, and capability manifest.

## Evidence requirements

Every layout fact cites a source ID, slide number, relevant element reference, source type, and locator. Separate repeated layouts from one-page exceptions and distinguish coordinates from visual relationships.

## UNKNOWN behavior

Without structural geometry, mark exact coordinates and grid values `UNKNOWN`; without rendering, mark overlap and perceived-density fields `UNKNOWN`. Always report `coverage`, `missing_capabilities`, and `unknown_fields`.

## Prohibited inference

Do not reconstruct coordinates from memory, assume a standard slide grid, or turn an isolated arrangement into a reusable layout rule.
