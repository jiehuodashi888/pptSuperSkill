import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CapabilityManifest } from "../contracts/types.js";
import { validateContract } from "../contracts/validate.js";
import { prepareGenerationResources, type GenerationResult } from "../generation/adapter.js";
import { NativeCreateAdapter } from "../generation/native-create.js";
import { buildProtectedPagePlan, type PlannedSlide } from "../generation/page-plan.js";
import { openInstance } from "../instances/store.js";
import { auditDeck, prepareProtectedResourceAudit, type AuditReport } from "../qa/audit.js";
import { openResourceRegistry } from "../resources/registry.js";
import { loadApprovedStyleLibrary } from "../resources/style-library.js";
import type { RuntimeDeploymentConfig } from "../resources/types.js";
import { requireProtectedRoute, routeProtectedScenario, type GenerationRequest, type ResolvedStyleSelection } from "../routing/router.js";

/** Content and declared capabilities only: no routes, libraries, resources or paths. */
export interface ProtectedWorkflowInput {
  readonly companyId: string;
  readonly requestId: string;
  readonly request: GenerationRequest;
  readonly slides: readonly PlannedSlide[];
  readonly capabilities: CapabilityManifest;
  readonly tokenOverrides?: Readonly<Record<string, unknown>>;
}

export interface ProtectedWorkflowReport {
  readonly classification: "production";
  readonly companyId: string;
  readonly styleId: string;
  readonly requestId: string;
  readonly resourceVersionSetHash: string;
  readonly outputDirectory: string;
  readonly cacheDirectory: string;
  readonly routing: ResolvedStyleSelection;
  readonly generatedDeck: GenerationResult & { readonly status: "created" };
  readonly audit: AuditReport;
}

/** Sole production orchestration entry. Deployment roots are trusted configuration;
 * final paths, registered resources and adapters are selected only by the runtime.
 * Filesystem checks are defense in depth, not protection from a malicious OS peer. */
export async function runProtectedWorkflow(input: ProtectedWorkflowInput, deployment: RuntimeDeploymentConfig): Promise<ProtectedWorkflowReport> {
  // Snapshot before the first await so caller mutation cannot switch identities/roots.
  input = structuredClone(input);
  deployment = structuredClone(deployment);
  validateInput(input);
  onlyKeys(deployment, ["instancesRoot", "coreResourcesRoot", "outputRoot", "cacheRoot"], "deployment");
  for (const root of Object.values(deployment)) requireLocalRoot(root);
  for (const key of ["instancesRoot", "coreResourcesRoot", "outputRoot", "cacheRoot"] as const) requireLocalRoot(deployment[key]);
  const store = await openInstance(deployment.instancesRoot, input.companyId);
  const registry = await openResourceRegistry(store, deployment);
  const library = await loadApprovedStyleLibrary(registry);
  const routing = requireProtectedRoute(routeProtectedScenario(input.request, library), registry);
  requireIdentifier(routing.styleId, "style");
  const resources = await prepareGenerationResources(routing, registry, {
    companyId: input.companyId, styleId: routing.styleId, requestId: input.requestId, purpose: "generate",
  });
  const pagePlan = buildProtectedPagePlan(routing, resources, input.slides, input.tokenOverrides);
  const resourceAudit = await prepareProtectedResourceAudit(registry, routing, input.requestId);
  const { resourceVersionSetHash } = resourceAudit;
  const outputRoot = await canonicalRoot(deployment.outputRoot);
  const cacheRoot = await canonicalRoot(deployment.cacheRoot);
  const outputDirectory = join(outputRoot, input.companyId, routing.styleId, input.requestId);
  const cacheDirectory = join(cacheRoot, input.companyId, routing.styleId, resourceVersionSetHash, input.requestId);
  // Validate both namespaces before creating either, including all existing ancestors.
  await verifyNamespace(outputRoot, outputDirectory);
  await verifyNamespace(cacheRoot, cacheDirectory);
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  await verifyNamespace(outputRoot, outputDirectory);
  await verifyNamespace(cacheRoot, cacheDirectory);
  // Native create is currently the only registered production generation adapter.
  const generatedDeck = await new NativeCreateAdapter().generateProtected({
    selection: routing, resources, pagePlan, capabilities: input.capabilities,
    outputDirectory, fileName: "presentation.pptx",
  });
  await verifyNamespace(outputRoot, outputDirectory);
  await verifyNamespace(cacheRoot, cacheDirectory);
  // No structural/render/image adapters are registered yet. auditDeck reports the
  // missing checks honestly, even if capabilities are declared available.
  const audit = await auditDeck({ deckPath: generatedDeck.outputPath, expectedSlideCount: generatedDeck.slideCount, capabilities: input.capabilities, resourceAudit });
  return Object.freeze({ classification: "production", companyId: input.companyId, styleId: routing.styleId,
    requestId: input.requestId, resourceVersionSetHash, outputDirectory, cacheDirectory, routing,
    generatedDeck: Object.freeze({ ...generatedDeck, status: "created" }), audit,
  });
}

function onlyKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`Unsupported ${label} field; paths, routes, resources and test-only reports cannot be supplied`);
}

function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) {
    throw new Error(`Invalid ${label} id`);
  }
}

function validateInput(input: ProtectedWorkflowInput): void {
  onlyKeys(input, ["companyId", "requestId", "request", "slides", "capabilities", "tokenOverrides"], "workflow input");
  requireIdentifier(input.companyId, "company");
  requireIdentifier(input.requestId, "request");
  onlyKeys(input.request, ["businessType", "audience", "department", "deliveryContext", "explicitTags"], "business request");
  for (const [key, value] of Object.entries(input.request)) {
    if (value === undefined) continue;
    if (key === "explicitTags" ? !Array.isArray(value) || value.some((tag) => typeof tag !== "string" || !tag.trim()) : typeof value !== "string" || !value.trim()) throw new Error("Invalid business request facts");
  }
  const validation = validateContract("capability-manifest", input.capabilities);
  if (!validation.ok) throw new Error(`Invalid capabilities: ${validation.errors.join("; ")}`);
  if (!input.capabilities.pptxWrite) throw new Error("Generation requires pptxWrite capability");
  if (!Array.isArray(input.slides) || !input.slides.length) throw new Error("Workflow requires slide content");
  for (const slide of input.slides) onlyKeys(slide, ["layoutId", "title", "body", "notes"], "slide");
  if (input.tokenOverrides !== undefined && (!input.tokenOverrides || typeof input.tokenOverrides !== "object" || Array.isArray(input.tokenOverrides))) throw new Error("Invalid token overrides");
}

function requireLocalRoot(value: unknown): asserts value is string {
  if (typeof value !== "string" || !isAbsolute(value) || /^[/\\]{2}/.test(value) || value.includes("\0")) throw new Error("Deployment roots must be absolute local directories");
  if (process.platform === "win32" && (!/^[a-z]:[/\\]/i.test(value) || /[:<>"|?*\x00-\x1f]/.test(value.slice(2)))) throw new Error("Deployment roots must be absolute local directories");
}

function requireWithin(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) throw new Error("Derived namespace escapes its canonical root");
}

async function verifyNamespace(root: string, directory: string): Promise<void> {
  const absoluteRoot = resolve(root);
  requireWithin(absoluteRoot, directory);
  let current = directory;
  while (true) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error("Derived namespace must not contain symbolic links or junctions");
      if (!entry.isDirectory()) throw new Error("Derived namespace ancestor is not a directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    requireWithin(await realpath(absoluteRoot), await realpath(directory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Preserve normal canonical aliases such as Windows 8.3 names, never links. */
async function canonicalRoot(root: string): Promise<string> {
  const absolute = resolve(root);
  await verifyNamespace(absolute, absolute);
  let ancestor = absolute;
  while (true) {
    try {
      return resolve(await realpath(ancestor), relative(ancestor, absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}
