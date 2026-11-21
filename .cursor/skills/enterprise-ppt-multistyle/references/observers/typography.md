# Typography observer

## Scope

Observe font families, sizes, hierarchy, weights, spacing, alignment, and number plus multilingual text conventions.

## Inputs

Use only current-instance source IDs, observation level, PPTX text and style facts, rendered slide assets, and the declared capability manifest.

## Evidence requirements

Every fact must cite a source ID, slide number, text element reference, source type, and locator. Distinguish structure-reported typography from rendered appearance and preserve page-level exceptions.

## UNKNOWN behavior

When font metadata or rendered appearance is unavailable, emit `UNKNOWN` for the affected field. Every result reports `coverage`, `missing_capabilities`, and `unknown_fields`.

## Prohibited inference

Do not guess a font from visual resemblance, substitute a font, infer a licensed family, or promote one slide's typography to a global rule without repeated evidence.
