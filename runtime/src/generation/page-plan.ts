import { requireProtectedRoute, type ApprovedRoute, type ResolvedStyleSelection } from "../routing/router.js";
import { requireGenerationResources, type PreparedGenerationResources } from "./adapter.js";

const EMU_PER_INCH = 914400;
// Supported subset: 1–56 inch slides, 1–400 pt text, and on-slide boxes
// at least one EMU wide/high. Staying below 100 inches also avoids
// PptxGenJS 3.x interpreting numeric layout values as preconverted EMUs.
const MAX_INCHES = 56;
const MAX_FONT_POINTS = 400;

export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Resolved values from the selected approved style. Dimensions are inches. */
export interface ApprovedTokens {
  readonly status: "approved";
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
  readonly titleColor: string;
  readonly bodyColor: string;
  readonly titleFontFace: string;
  readonly bodyFontFace: string;
  readonly titleFontSize: number;
  readonly bodyFontSize: number;
}

export interface ApprovedLayout {
  readonly id: string;
  readonly status: "approved";
  readonly title: LayoutBox;
  readonly body: LayoutBox;
}

export interface PlannedSlide {
  readonly layoutId: string;
  readonly title: string;
  readonly body: string;
  readonly notes?: string;
}

/** Low-level/test-only value shape. Production uses buildProtectedPagePlan. */
export interface PagePlan {
  readonly styleRef: string;
  readonly tokens: ApprovedTokens;
  readonly layouts: readonly ApprovedLayout[];
  readonly slides: readonly PlannedSlide[];
}

export function validatePagePlan(plan: PagePlan, route: ApprovedRoute): void {
  if (!plan || !route.styleRefs.includes(plan.styleRef)) {
    throw new Error("Page plan must use an approved route style");
  }
  const tokens = plan.tokens;
  if (!tokens || tokens.status !== "approved") {
    throw new Error("Page plan tokens must be approved");
  }
  const widthEmu = checkedMeasurement(tokens.width, 1, MAX_INCHES, EMU_PER_INCH, "slide width dimension");
  const heightEmu = checkedMeasurement(tokens.height, 1, MAX_INCHES, EMU_PER_INCH, "slide height dimension");
  for (const value of [tokens.titleFontSize, tokens.bodyFontSize]) {
    checkedMeasurement(value, 1, MAX_FONT_POINTS, 100, "font size");
  }
  for (const color of [tokens.backgroundColor, tokens.titleColor, tokens.bodyColor]) {
    if (typeof color !== "string" || !/^[0-9A-Fa-f]{6}$/.test(color)) throw new Error("Invalid approved color token: expected six hex digits");
  }
  for (const font of [tokens.titleFontFace, tokens.bodyFontFace]) {
    // PptxGenJS 3.x inserts font names directly into XML attributes.
    if (typeof font !== "string" || !font.trim() || /["<>&]/.test(font) || !isXmlText(font)) throw new Error("Invalid approved font token");
  }
  if (!Array.isArray(plan.layouts)) throw new Error("Page plan requires approved layouts");
  const layoutIds = new Set<string>();
  for (const layout of plan.layouts) {
    if (!layout || layout.status !== "approved" || typeof layout.id !== "string" || !layout.id.trim() || layoutIds.has(layout.id)) {
      throw new Error("Page plan requires unique approved layouts");
    }
    layoutIds.add(layout.id);
    for (const box of [layout.title, layout.body]) {
      if (!box) throw new Error("Approved layout box is required");
      const x = checkedMeasurement(box.x, 0, MAX_INCHES, EMU_PER_INCH, "layout x");
      const y = checkedMeasurement(box.y, 0, MAX_INCHES, EMU_PER_INCH, "layout y");
      const w = checkedMeasurement(box.w, 1 / EMU_PER_INCH, MAX_INCHES, EMU_PER_INCH, "layout width");
      const h = checkedMeasurement(box.h, 1 / EMU_PER_INCH, MAX_INCHES, EMU_PER_INCH, "layout height");
      if (box.x + box.w > tokens.width || box.y + box.h > tokens.height || x + w > widthEmu || y + h > heightEmu) {
        throw new Error("Approved layout box exceeds slide bounds");
      }
    }
  }
  if (!Array.isArray(plan.slides) || !plan.slides.length) throw new Error("Page plan requires at least one slide");
  for (const slide of plan.slides) {
    if (!slide || !layoutIds.has(slide.layoutId)) throw new Error("Slide references an unavailable approved layout");
    if (typeof slide.title !== "string" || typeof slide.body !== "string" || (slide.notes !== undefined && typeof slide.notes !== "string")) {
      throw new Error("Slide content must be text");
    }
    if (![slide.title, slide.body, slide.notes ?? ""].every(isXmlText)) {
      throw new Error("Slide text contains invalid XML characters");
    }
  }
}

/** Match the generator's integer conversions, checking input and output ranges. */
function checkedMeasurement(value: number, min: number, max: number, scale: number, label: string): number {
  const converted = Math.round(value * scale);
  if (!Number.isFinite(value) || value < min || value > max || !Number.isSafeInteger(converted) || converted < Math.ceil(min * scale) || converted > Math.floor(max * scale)) {
    throw new Error(`Approved ${label} is outside the supported numeric range`);
  }
  return converted;
}

function isXmlText(value: string): boolean {
  return !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value);
}

const protectedPlans = new WeakMap<object, { selection: ResolvedStyleSelection; resources: PreparedGenerationResources }>();

/** Derive all styling from authentic handles; callers supply slide content only. */
export function buildProtectedPagePlan(
  selection: ResolvedStyleSelection,
  resources: PreparedGenerationResources,
  slides: readonly PlannedSlide[],
  tokenOverrides: Readonly<Record<string, unknown>> = {},
): PagePlan {
  const route = requireProtectedRoute(selection);
  requireGenerationResources(resources, selection);
  if (!resources.tokens.length || !resources.layouts.length) throw new Error("Protected page plan requires registered tokens and layouts");
  const merged: Record<string, unknown> = Object.create(null);
  const precedence = { core: 0, company: 1, style: 2, request: 3, quarantine: 4 };
  const tokenHandles = [...resources.tokens].sort((left, right) => precedence[left.ref.scope] - precedence[right.ref.scope]);
  for (const handle of tokenHandles) {
    const value: unknown = JSON.parse(Buffer.from(handle.bytes).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Registered token-set must contain an object");
    mergeTokens(value as Record<string, unknown>, false);
  }
  mergeTokens(tokenOverrides, true);
  const layouts = resources.layouts.flatMap((handle) => {
    const value: unknown = JSON.parse(Buffer.from(handle.bytes).toString("utf8"));
    return (Array.isArray(value) ? value : [value]) as ApprovedLayout[];
  });
  const plan: PagePlan = { styleRef: route.styleId, tokens: merged as unknown as ApprovedTokens, layouts, slides: structuredClone(slides) };
  validatePagePlan(plan, { styleRefs: [route.styleId], templateRefs: [], confidence: route.confidence, evidence: [] });
  deepFreeze(plan);
  protectedPlans.set(plan, { selection, resources });
  return plan;

  function mergeTokens(values: Readonly<Record<string, unknown>>, requestOverride: boolean) {
    for (const [key, value] of Object.entries(values)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid token key");
      const changes = Object.hasOwn(merged, key) && merged[key] !== value;
      if (requestOverride || changes) {
        if (!route.tokenOverridePolicy?.allowedTokenKeys.includes(key) || route.tokenOverridePolicy.forbiddenTokenKeys.includes(key)) {
          throw new Error(`Token override is not allowed: ${key}`);
        }
      }
      merged[key] = structuredClone(value);
    }
  }
}

/** A copied plan or one issued for another selection/resource bundle is rejected. */
export function validateProtectedPagePlan(plan: PagePlan, selection: ResolvedStyleSelection, resources: PreparedGenerationResources): void {
  requireGenerationResources(resources, selection);
  const binding = plan && protectedPlans.get(plan);
  if (!binding || binding.selection !== selection || binding.resources !== resources) throw new Error("Authentic page plan bound to this protected route and resources required");
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}
