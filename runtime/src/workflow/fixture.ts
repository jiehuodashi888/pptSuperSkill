import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { detectCapabilities } from "../capabilities/detect.js";
import type { CapabilityManifest } from "../contracts/types.js";
import { validateContract } from "../contracts/validate.js";
import { generatePresentation, type GenerationResult } from "../generation/adapter.js";
import { NativeCreateAdapter } from "../generation/native-create.js";
import type { PagePlan } from "../generation/page-plan.js";
import { openInstance } from "../instances/store.js";
import { auditRun } from "../orchestration/audit.js";
import type { ModelAdapter } from "../orchestration/model-adapter.js";
import { observeDeck, type ObservationRun } from "../orchestration/observe.js";
import { auditDeck, type AuditInput, type AuditReport } from "../qa/audit.js";
import { requireApprovedRoute, routeScenario, type GenerationRequest, type RoutingDecision, type StyleLibrary } from "../routing/router.js";

/** Synthetic or explicitly acquired TEST input, never enterprise learning evidence.
 * Library and plan are caller-resolved test data, not an approval import format.
 */
export interface LocalWorkflowFixture {
  readonly sourceId: string;
  readonly structuralFacts?: unknown;
  readonly request: GenerationRequest;
  readonly library: StyleLibrary;
  readonly pagePlan: PagePlan;
}

export interface FixtureWorkflowOptions {
  readonly instancesRoot: string;
  readonly companyId: string;
  readonly fixturePath: string;
  readonly outputDirectory: string;
  readonly fileName: string;
  readonly capabilities: CapabilityManifest;
  readonly modelAdapter: ModelAdapter;
  readonly qa?: Pick<AuditInput, "structural" | "visual">;
}

export interface WorkflowReport {
  readonly companyId: string;
  readonly classification: "test-only";
  readonly capabilities: CapabilityManifest;
  readonly observationRun: ObservationRun;
  readonly observationAudit: ReturnType<typeof auditRun>;
  readonly routing: RoutingDecision;
  readonly generatedDeck: GenerationResult & { readonly status: "created" };
  readonly audit: AuditReport & { readonly complete: boolean };
}

/** Runs public contracts without promoting rules, publishing taxonomies, or fetching. */
export async function runFixtureWorkflow(options: FixtureWorkflowOptions): Promise<WorkflowReport> {
  const { instancesRoot, companyId, fixturePath, outputDirectory, fileName, modelAdapter } = options;
  const capabilities = detectCapabilities(options.capabilities);
  const qa = { structural: options.qa?.structural, visual: options.qa?.visual };
  const validation = validateContract("capability-manifest", capabilities);
  if (!validation.ok) throw new Error(`Invalid capabilities: ${validation.errors.join("; ")}`);
  if (!isAbsolute(fixturePath)) throw new Error("Fixture path must be an explicit local absolute path");
  const store = await openInstance(instancesRoot, companyId);
  for (const asset of store.manifest.assets) store.resolve(asset);
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as LocalWorkflowFixture;
  if (!fixture || typeof fixture.sourceId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(fixture.sourceId) || !fixture.request || !Array.isArray(fixture.library?.styles) || !Array.isArray(fixture.library?.approvedMappings) || !fixture.pagePlan) {
    throw new Error("Invalid local workflow fixture");
  }
  const observationRun = await observeDeck({ companyId, level: "deck", sourceIds: [fixture.sourceId], capabilities, structuralFacts: fixture.structuralFacts }, modelAdapter);
  const observationAudit = auditRun(observationRun);
  const routing = routeScenario(fixture.request, fixture.library);
  const route = requireApprovedRoute(routing);
  const generated = await generatePresentation({ mode: "native-create", route, pagePlan: fixture.pagePlan, capabilities, outputDirectory, fileName }, [new NativeCreateAdapter()]);
  const audit = await auditDeck({ deckPath: generated.outputPath, expectedSlideCount: generated.slideCount, capabilities, ...qa });
  return { companyId, classification: "test-only", capabilities, observationRun, observationAudit, routing, generatedDeck: { ...generated, status: "created" }, audit: { ...audit, complete: audit.coverage.complete } };
}
