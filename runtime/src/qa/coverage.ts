export type PhaseStatus = "passed" | "failed" | "incomplete" | "not-run";

export interface Coverage {
  readonly complete: boolean;
  readonly gaps: readonly string[];
}

/** Adapter declarations must account for every expected slide exactly once. */
export function slideCoverageGaps(checked: readonly number[], expected: number, label: string): string[] {
  if (!Array.isArray(checked) || checked.some((n) => !Number.isInteger(n) || n < 1 || n > expected) || new Set(checked).size !== checked.length) {
    throw new Error(`${label} returned invalid or duplicate slide numbers`);
  }
  const seen = new Set(checked);
  const missing = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !seen.has(n));
  return missing.length ? [`${label} did not cover slides: ${missing.join(", ")}`] : [];
}

export function aggregateCoverage(phases: readonly { status: PhaseStatus; gaps: readonly string[] }[]): Coverage {
  const gaps = [...new Set(phases.flatMap((phase) => phase.gaps))];
  return {
    complete: gaps.length === 0 && phases.every((phase) => phase.status === "passed" || phase.status === "failed"),
    gaps,
  };
}
