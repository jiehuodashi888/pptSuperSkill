import type { CapabilityManifest } from "../contracts/types.js";
import { isAuthenticApprovedRoute, type ApprovedRoute } from "../routing/router.js";
import { validatePagePlan, type PagePlan } from "./page-plan.js";

export type GenerationMode = "native-create" | "template-fill" | "existing-deck-edit";

export interface GenerationInput {
  readonly mode: GenerationMode;
  readonly route: ApprovedRoute;
  readonly pagePlan: PagePlan;
  readonly capabilities: CapabilityManifest;
  readonly outputDirectory: string;
  readonly fileName: string;
}

export interface GenerationResult {
  readonly mode: GenerationMode;
  readonly outputPath: string;
  readonly slideCount: number;
}

/** Local document generation contract, independent of any model provider. */
export interface GenerationAdapter {
  readonly mode: GenerationMode;
  generate(input: GenerationInput): Promise<GenerationResult>;
}

/** Capture caller-owned data once; keep the issued route handle by identity. */
export function snapshotGenerationInput(input: GenerationInput): GenerationInput {
  return {
    mode: input.mode,
    route: input.route,
    pagePlan: structuredClone(input.pagePlan),
    capabilities: structuredClone(input.capabilities),
    outputDirectory: input.outputDirectory,
    fileName: input.fileName,
  };
}

export function validateGenerationInput(input: GenerationInput): void {
  if (!isAuthenticApprovedRoute(input.route)) throw new Error("Generation requires an authentic issued ApprovedRoute");
  if (!["native-create", "template-fill", "existing-deck-edit"].includes(input.mode)) throw new Error("Unsupported generation mode");
  if (input.capabilities?.pptxWrite !== true) throw new Error("Generation requires pptxWrite capability");
  if (input.mode !== "native-create" && input.capabilities?.pptxRead !== true) throw new Error(`${input.mode} requires pptxRead capability`);
  validatePagePlan(input.pagePlan, input.route);
}

/** Missing adapters are errors; generation never substitutes another mode. */
export async function generatePresentation(
  input: GenerationInput,
  adapters: readonly GenerationAdapter[],
): Promise<GenerationResult> {
  input = snapshotGenerationInput(input);
  validateGenerationInput(input);
  const adapter = adapters.find((candidate) => candidate.mode === input.mode);
  if (!adapter) throw new Error(`No generation adapter available for ${input.mode}`);
  return adapter.generate(input);
}
