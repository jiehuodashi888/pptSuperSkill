import type { CapabilityManifest } from "../contracts/types.js";
import { isAuthenticApprovedRoute, requireProtectedRoute, type ApprovedRoute, type ResolvedStyleSelection } from "../routing/router.js";
import { isAuthenticResolvedResource, resolveResource, type ResolvedResource, type ResourceAccessContext } from "../resources/resolver.js";
import type { ResourceRegistry } from "../resources/types.js";
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

/** Low-level/test-only generation. Production must prepare protected resources first.
 * Missing adapters are errors; generation never substitutes another mode. */
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

export interface PreparedGenerationResources {
  readonly companyId: string;
  readonly styleId: string;
  readonly requestId?: string;
  readonly templates: readonly ResolvedResource[];
  readonly tokens: readonly ResolvedResource[];
  readonly layouts: readonly ResolvedResource[];
}

/** Production adapters receive only a bound protected route, resource bundle and plan. */
export interface ProtectedGenerationInput {
  readonly selection: ResolvedStyleSelection;
  readonly resources: PreparedGenerationResources;
  readonly pagePlan: PagePlan;
  readonly capabilities: CapabilityManifest;
  readonly outputDirectory: string;
  readonly fileName: string;
}

const generationResources = new WeakMap<object, ResolvedStyleSelection>();

/** Resolves the exact registered refs under generate authorization; never accepts paths. */
export async function prepareGenerationResources(
  selection: ResolvedStyleSelection,
  registry: ResourceRegistry,
  context: ResourceAccessContext,
): Promise<PreparedGenerationResources> {
  const route = requireProtectedRoute(selection, registry);
  const access = Object.freeze({ ...context });
  if (access.companyId !== route.companyId) throw new Error("Generation company must match the protected selection");
  if (access.styleId !== route.styleId) throw new Error("Generation style must match the protected selection");
  if (access.purpose !== "generate") throw new Error("Generation resource purpose must be generate");
  const resolve = async (refs: typeof route.resources.templates) => Object.freeze(await Promise.all(refs.map((ref) => resolveResource(registry, ref, access))));
  const [templates, tokens, layouts] = await Promise.all([resolve(route.resources.templates), resolve(route.resources.tokens), resolve(route.resources.layouts)]);
  const resources = Object.freeze({ companyId: route.companyId, styleId: route.styleId, requestId: access.requestId, templates, tokens, layouts });
  generationResources.set(resources, selection);
  return resources;
}

/** Authenticity includes the selected route, preventing replacement with other handles. */
export function requireGenerationResources(resources: PreparedGenerationResources, selection: ResolvedStyleSelection): PreparedGenerationResources {
  requireProtectedRoute(selection);
  if (!resources || generationResources.get(resources) !== selection) throw new Error("Authentic generation resources bound to this protected route required");
  for (const handle of [...resources.templates, ...resources.tokens, ...resources.layouts]) {
    if (!isAuthenticResolvedResource(handle)) throw new Error("Authentic resolver handles required");
  }
  return resources;
}
