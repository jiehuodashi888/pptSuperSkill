import type { ApprovedRoute } from "../routing/router.js";

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

/** Values must be resolved by the caller from its approved instance assets. */
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
  for (const value of [tokens.width, tokens.height, tokens.titleFontSize, tokens.bodyFontSize]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid approved token dimension or font size");
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
      if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0 || box.x + box.w > tokens.width || box.y + box.h > tokens.height) {
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

function isXmlText(value: string): boolean {
  return !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value);
}
