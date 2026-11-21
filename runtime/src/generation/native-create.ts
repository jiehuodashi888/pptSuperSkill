import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { snapshotGenerationInput, validateGenerationInput, type GenerationAdapter, type GenerationInput, type GenerationResult } from "./adapter.js";
import type { LayoutBox } from "./page-plan.js";

// 3.x exports a CommonJS constructor although its declarations use export default.
const PptxGenJS = createRequire(import.meta.url)("pptxgenjs") as typeof import("pptxgenjs").default;

export class NativeCreateAdapter implements GenerationAdapter {
  readonly mode = "native-create" as const;

  async generate(input: GenerationInput): Promise<GenerationResult> {
    input = snapshotGenerationInput(input);
    if (input.mode !== this.mode) throw new Error(`Native adapter does not support ${input.mode}`);
    validateGenerationInput(input);
    validateOutput(input.outputDirectory, input.fileName);

    const plan = input.pagePlan;
    const outputDirectory = input.outputDirectory;
    const fileName = input.fileName;
    const tokens = plan.tokens;
    const deck = new PptxGenJS();
    deck.defineLayout({ name: "APPROVED", width: tokens.width, height: tokens.height });
    deck.layout = "APPROVED";
    deck.theme = { headFontFace: tokens.titleFontFace, bodyFontFace: tokens.bodyFontFace };

    for (const page of plan.slides) {
      const layout = plan.layouts.find((candidate) => candidate.id === page.layoutId)!;
      const slide = deck.addSlide();
      slide.background = { color: tokens.backgroundColor };
      slide.addText(page.title, { ...coordinates(layout.title), fontFace: tokens.titleFontFace, fontSize: tokens.titleFontSize, color: tokens.titleColor, margin: 0 });
      slide.addText(page.body, { ...coordinates(layout.body), fontFace: tokens.bodyFontFace, fontSize: tokens.bodyFontSize, color: tokens.bodyColor, margin: 0 });
      if (page.notes !== undefined) slide.addNotes(page.notes);
    }

    const bytes = await deck.write({ outputType: "nodebuffer" });
    await rejectDirectoryLinks(outputDirectory);
    await mkdir(outputDirectory, { recursive: true });
    await rejectDirectoryLinks(outputDirectory);
    const canonicalDirectory = await realpath(outputDirectory);
    validateOutput(canonicalDirectory, fileName);
    const outputPath = join(canonicalDirectory, fileName);
    // Exclusive creation also refuses existing symlinks and never replaces a deck.
    await writeFile(outputPath, bytes as Buffer, { flag: "wx" });
    return { mode: this.mode, outputPath, slideCount: plan.slides.length };
  }
}

function validateOutput(directory: string, fileName: string): void {
  if (typeof directory !== "string" || !isAbsolute(directory) || /^[/\\]{2}/.test(directory) || directory.includes("\0") || (process.platform === "win32" && !/^[a-z]:[/\\]/i.test(directory))) {
    throw new Error("Output directory must be an explicit absolute local directory");
  }
  if (typeof fileName !== "string" || !/^[^<>:"/\\|?*\x00-\x1f]+\.pptx$/i.test(fileName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(fileName)) {
    throw new Error("Output file name must be a local .pptx basename");
  }
}

function coordinates(box: LayoutBox): LayoutBox {
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** Check existing ancestors too: mkdir must not follow a junction outside the request. */
async function rejectDirectoryLinks(directory: string): Promise<void> {
  let current = resolve(directory);
  while (true) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error("Output directory must not contain symbolic links or junctions");
      if (!entry.isDirectory()) throw new Error("Output directory ancestor is not a directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
