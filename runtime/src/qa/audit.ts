import type { CapabilityManifest, Evidence } from "../contracts/types.js";
import { aggregateCoverage, slideCoverageGaps, type Coverage, type PhaseStatus } from "./coverage.js";
import type { RepairRecommendation } from "./repair.js";
import { snapshotQaData } from "./snapshot.js";

export type Severity = "critical" | "error" | "warning" | "info";

export interface AuditFinding {
  finding_id: string;
  severity: Severity;
  rule_ref: string;
  evidence: Evidence[];
  repairability: "mechanical" | "approval-required" | "none";
  recommended_fix: RepairRecommendation | null;
}

export interface CheckResult {
  readonly findings: readonly AuditFinding[];
  readonly checkedSlides: readonly number[];
  /** Unchecked rules or unsupported elements, even when all slides were visited. */
  readonly gaps?: readonly string[];
}

export interface RenderedSlide {
  readonly slideNumber: number;
  readonly imagePath: string;
}

export interface AuditInput {
  readonly deckPath: string;
  readonly expectedSlideCount: number;
  readonly capabilities: CapabilityManifest;
  /** Inspect the actual deck's structure; page-plan validation is not deck QA. */
  readonly structural?: { inspect(deckPath: string): Promise<CheckResult> };
  readonly visual?: {
    render(deckPath: string): Promise<readonly RenderedSlide[]>;
    analyze(slides: readonly RenderedSlide[]): Promise<CheckResult>;
  };
}

export interface PhaseReport {
  readonly status: PhaseStatus;
  readonly findings: readonly AuditFinding[];
  readonly gaps: readonly string[];
}

export interface AuditReport {
  readonly status: Exclude<PhaseStatus, "not-run">;
  readonly structural: PhaseReport;
  readonly visual: PhaseReport;
  readonly findings: readonly AuditFinding[];
  readonly severityCounts: Readonly<Record<Severity, number>>;
  readonly maxSeverity: Severity | null;
  readonly coverage: Coverage;
}

const severities: readonly Severity[] = ["critical", "error", "warning", "info"];

/** Aggregate adapter evidence; never infer a successful check from capabilities. */
export async function auditDeck(input: AuditInput): Promise<AuditReport> {
  const { deckPath, expectedSlideCount } = input;
  if (typeof deckPath !== "string" || !deckPath.trim() || !Number.isSafeInteger(expectedSlideCount) || expectedSlideCount < 1) {
    throw new Error("Audit requires a deck path and a positive expected slide count");
  }
  const capabilities = { ...input.capabilities };
  // Capture methods before async execution so later caller edits cannot switch adapters.
  const structuralAdapter = input.structural;
  const visualAdapter = input.visual;
  const inspectMethod = structuralAdapter?.inspect;
  const renderMethod = visualAdapter?.render;
  const analyzeMethod = visualAdapter?.analyze;
  const inspect = typeof inspectMethod === "function" ? inspectMethod.bind(structuralAdapter) : undefined;
  const render = typeof renderMethod === "function" ? renderMethod.bind(visualAdapter) : undefined;
  const analyze = typeof analyzeMethod === "function" ? analyzeMethod.bind(visualAdapter) : undefined;
  const structuralGaps: string[] = [];
  if (capabilities.pptxRead !== true) structuralGaps.push("Structural QA requires pptxRead capability");
  if (!inspect) structuralGaps.push("Structural QA adapter unavailable");
  const visualGaps: string[] = [];
  if (capabilities.renderSlides !== true) visualGaps.push("Visual QA requires renderSlides capability");
  if (capabilities.imageAnalysis !== true) visualGaps.push("Visual QA requires imageAnalysis capability");
  if (!render || !analyze) visualGaps.push("Visual QA adapter unavailable");

  const [structural, visual] = await Promise.all([
    runPhase("Structural QA", structuralGaps, expectedSlideCount, () => inspect!(deckPath)),
    runPhase("Visual QA", visualGaps, expectedSlideCount, async () => {
      const slides = structuredClone(await render!(deckPath));
      if (!Array.isArray(slides) || slides.some((slide) => !slide || typeof slide.imagePath !== "string" || !slide.imagePath.trim())) {
        throw new Error("Renderer returned invalid slide images");
      }
      const gaps = slideCoverageGaps(slides.map((slide) => slide.slideNumber), expectedSlideCount, "Rendering");
      if (gaps.length) return { findings: [], checkedSlides: [], gaps };
      return analyze!(slides);
    }),
  ]);
  const findings = sortFindings([...structural.findings, ...visual.findings]);
  const severityCounts: Record<Severity, number> = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const finding of findings) severityCounts[finding.severity]++;
  const coverage = aggregateCoverage([structural, visual]);
  return {
    status: hasFailure(findings) ? "failed" : coverage.complete ? "passed" : "incomplete",
    structural, visual, findings, severityCounts,
    maxSeverity: severities.find((severity) => severityCounts[severity] > 0) ?? null,
    coverage,
  };
}

async function runPhase(label: string, unavailable: string[], expected: number, run: () => Promise<CheckResult>): Promise<PhaseReport> {
  if (unavailable.length) return { status: "not-run", findings: [], gaps: unavailable };
  try {
    const result = snapshotQaData(await run());
    if (!result || !Array.isArray(result.findings) || (result.gaps !== undefined && (!Array.isArray(result.gaps) || result.gaps.some((gap) => typeof gap !== "string" || !gap.trim())))) {
      throw new Error("Adapter returned an invalid check result");
    }
    const gaps = [...slideCoverageGaps(result.checkedSlides, expected, label), ...(result.gaps ?? []).map((gap) => `${label}: ${gap}`)];
    for (const finding of result.findings) validateFinding(finding, expected);
    const findings = sortFindings(result.findings);
    return { status: hasFailure(findings) ? "failed" : gaps.length ? "incomplete" : "passed", findings, gaps };
  } catch (error) {
    return { status: "incomplete", findings: [], gaps: [`${label} incomplete: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function validateFinding(finding: AuditFinding, expected: number): void {
  if (!finding || !severities.includes(finding.severity) || typeof finding.finding_id !== "string" || !finding.finding_id.trim() || typeof finding.rule_ref !== "string" || !finding.rule_ref.trim() || !["mechanical", "approval-required", "none"].includes(finding.repairability) || !Array.isArray(finding.evidence) || !finding.evidence.length) {
    throw new Error("Adapter returned an invalid or unevidenced finding");
  }
  for (const evidence of finding.evidence) {
    if (!evidence || !Number.isInteger(evidence.slide_number) || evidence.slide_number < 1 || evidence.slide_number > expected || [evidence.source_id, evidence.element_ref, evidence.source_type, evidence.locator].some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("Adapter returned invalid finding evidence");
    }
  }
}

function hasFailure(findings: readonly AuditFinding[]): boolean {
  return findings.some(({ severity }) => severity === "critical" || severity === "error");
}

function sortFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return [...findings].sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity) || compare(a.finding_id, b.finding_id) || compare(stableJson(a), stableJson(b)));
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
