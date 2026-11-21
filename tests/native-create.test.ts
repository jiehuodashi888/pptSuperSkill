import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import JSZip from "jszip";

import { generatePresentation, type GenerationInput } from "../runtime/src/generation/adapter.js";
import { NativeCreateAdapter } from "../runtime/src/generation/native-create.js";
import type { PagePlan } from "../runtime/src/generation/page-plan.js";
import { requireApprovedRoute, routeScenario } from "../runtime/src/routing/router.js";

function plan(): PagePlan {
  return {
    styleRef: "styles/approved",
    tokens: {
      status: "approved", width: 10, height: 5.625,
      backgroundColor: "FFFFFF", titleColor: "112233", bodyColor: "334455",
      titleFontFace: "Arial", bodyFontFace: "Calibri", titleFontSize: 32, bodyFontSize: 18,
    },
    layouts: [
      { id: "opening", status: "approved", title: { x: 1, y: 1, w: 8, h: 1 }, body: { x: 1, y: 3, w: 8, h: 1 } },
      { id: "detail", status: "approved", title: { x: 0.5, y: 0.5, w: 9, h: 1 }, body: { x: 0.5, y: 2, w: 9, h: 3 } },
    ],
    slides: [
      { layoutId: "opening", title: "Annual report", body: "Editable executive summary" },
      { layoutId: "detail", title: "Results", body: "Revenue & growth", notes: "Source: approved report" },
    ],
  };
}

async function input(): Promise<GenerationInput> {
  const facts = { businessType: "annual-report", audience: "executive", department: "finance", deliveryContext: "board" };
  const route = requireApprovedRoute(routeScenario(facts, {
    styles: [{ ref: "styles/approved", status: "approved", businessTypes: [facts.businessType], audiences: [facts.audience], departments: [facts.department], deliveryContexts: [facts.deliveryContext], tags: [], templateRefs: ["templates/approved.potx"] }],
    approvedMappings: [],
  }));
  return {
    mode: "native-create", route, pagePlan: plan(),
    capabilities: { pptxRead: false, pptxWrite: true, renderSlides: false, imageAnalysis: false, parallelAgents: false },
    outputDirectory: await mkdtemp(join(tmpdir(), "native-pptx-")),
    fileName: "report.pptx",
  };
}

test("native generation writes an editable two-slide PPTX with approved tokens and layout coordinates", async () => {
  const request = await input();
  const result = await new NativeCreateAdapter().generate(request);
  assert.equal(result.mode, "native-create");
  assert.equal(result.outputPath, join(await realpath(request.outputDirectory), "report.pptx"));
  assert.equal(result.slideCount, 2);
  const bytes = await readFile(result.outputPath);
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("_rels/.rels"));
  assert.equal(Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 2);
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  assert.equal((presentation.match(/<p:sldId /g) ?? []).length, 2);
  assert.match(presentation, /cx="9144000" cy="5143500"/);
  const first = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const second = await zip.file("ppt/slides/slide2.xml")!.async("string");
  assert.match(first, /<p:sp>/);
  assert.match(first, /<a:t>Annual report<\/a:t>/);
  assert.match(first, /Editable executive summary/);
  assert.match(first, /<a:off x="914400" y="914400"/);
  assert.match(first, /sz="3200"/);
  assert.match(first, /112233/);
  assert.match(first, /334455/);
  assert.match(first, /typeface="Arial"/);
  assert.match(first, /typeface="Calibri"/);
  assert.match(second, /<a:off x="457200" y="457200"/);
  assert.match(second, /Revenue &amp; growth/);
  assert.match(await zip.file("ppt/notesSlides/notesSlide2.xml")!.async("string"), /Source: approved report/);
  assert.equal(Object.values(zip.files).filter((entry) => !entry.dir && /^ppt\/media\//.test(entry.name)).length, 0);
  assert.deepEqual(await readdir(request.outputDirectory), ["report.pptx"]);
});

test("each generation starts a fresh presentation", async () => {
  const request = await input();
  const adapter = new NativeCreateAdapter();
  await adapter.generate(request);
  const next = await adapter.generate({ ...request, fileName: "second.pptx", pagePlan: { ...request.pagePlan, slides: [request.pagePlan.slides[0]] } });
  const zip = await JSZip.loadAsync(await readFile(next.outputPath));
  assert.equal(Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 1);
});

test("layout data cannot inject additional PptxGenJS options", async () => {
  const request = await input();
  const layout = request.pagePlan.layouts[0];
  const pagePlan = {
    ...request.pagePlan,
    layouts: [{ ...layout, title: { ...layout.title, hyperlink: { url: "https://unexpected.example" }, rotate: 90 } }, request.pagePlan.layouts[1]],
  };
  const result = await new NativeCreateAdapter().generate({ ...request, pagePlan });
  const zip = await JSZip.loadAsync(await readFile(result.outputPath));
  const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const relationships = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  assert.doesNotMatch(slide, /hlinkClick|rot="5400000"/);
  assert.doesNotMatch(relationships, /unexpected\.example/);
});

test("generation uses the same token snapshot it validated", async () => {
  const request = await input();
  let reads = 0;
  Object.defineProperty(request.pagePlan.tokens, "titleColor", {
    enumerable: true,
    get: () => ++reads === 1 ? "112233" : "445566",
  });
  const result = await new NativeCreateAdapter().generate(request);
  const zip = await JSZip.loadAsync(await readFile(result.outputPath));
  const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(slide, /112233/);
  assert.doesNotMatch(slide, /445566/);
});

test("output directories cannot redirect generation through directory links", async () => {
  const request = await input();
  const outside = await mkdtemp(join(tmpdir(), "native-pptx-outside-"));
  const alias = join(request.outputDirectory, "alias");
  await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(new NativeCreateAdapter().generate({ ...request, outputDirectory: alias }), /link|directory/i);
  await assert.rejects(new NativeCreateAdapter().generate({ ...request, outputDirectory: join(alias, "new") }), /link|directory/i);
  assert.deepEqual(await readdir(outside), []);
});

test("generation refuses copied or fabricated route approvals before writing", async () => {
  const request = await input();
  for (const route of [{ ...request.route }, JSON.parse(JSON.stringify(request.route))]) {
    await assert.rejects(new NativeCreateAdapter().generate({ ...request, route }), /authentic|issued/i);
  }
  assert.deepEqual(await readdir(request.outputDirectory), []);
});

test("generation rejects an unapproved or mismatched page plan before writing", async () => {
  const request = await input();
  const invalidPlans = [
    { ...plan(), styleRef: "styles/not-selected" },
    { ...plan(), tokens: { ...plan().tokens, status: "candidate" } },
    { ...plan(), layouts: [{ ...plan().layouts[0], status: "candidate" }] },
    { ...plan(), slides: [{ layoutId: "missing", title: "Title", body: "Body" }] },
    { ...plan(), tokens: { ...plan().tokens, titleColor: "#112233" } },
    { ...plan(), layouts: [{ ...plan().layouts[0], title: { x: 9, y: 1, w: 8, h: 1 } }] },
    { ...plan(), slides: [] },
  ];
  for (const pagePlan of invalidPlans) {
    await assert.rejects(new NativeCreateAdapter().generate({ ...request, pagePlan: pagePlan as PagePlan }), /approved|layout|color|bounds|slide/i);
  }
  assert.deepEqual(await readdir(request.outputDirectory), []);
});

test("generation rejects text and font tokens that would create invalid XML", async () => {
  const request = await input();
  for (const font of ['Bad"Font', "Bad&Font", "Bad<Font", "Bad\u0000Font"]) {
    await assert.rejects(new NativeCreateAdapter().generate({
      ...request, pagePlan: { ...plan(), tokens: { ...plan().tokens, titleFontFace: font } },
    }), /font|XML/i);
  }
  for (const text of ["Bad\u0000text", "Bad\uFFFEtext", "Bad\uD800text"]) {
    await assert.rejects(new NativeCreateAdapter().generate({
      ...request, pagePlan: { ...plan(), slides: [{ layoutId: "opening", title: text, body: "Body" }] },
    }), /text|XML/i);
  }
  assert.deepEqual(await readdir(request.outputDirectory), []);
});

test("missing write capability and unsupported adapters fail without native fallback", async () => {
  const request = await input();
  await assert.rejects(new NativeCreateAdapter().generate({ ...request, capabilities: { ...request.capabilities, pptxWrite: false } }), /pptxWrite/);
  for (const mode of ["template-fill", "existing-deck-edit"] as const) {
    await assert.rejects(new NativeCreateAdapter().generate({ ...request, mode }), /adapter|unsupported/i);
    await assert.rejects(generatePresentation({ ...request, mode }, [new NativeCreateAdapter()]), /pptxRead|adapter/i);
    await assert.rejects(generatePresentation({ ...request, mode, capabilities: { ...request.capabilities, pptxRead: true } }, [new NativeCreateAdapter()]), /adapter/i);
  }
  assert.deepEqual(await readdir(request.outputDirectory), []);
});

test("adapter dispatch preserves native generation", async () => {
  const request = await input();
  const result = await generatePresentation(request, [new NativeCreateAdapter()]);
  assert.ok((await readFile(result.outputPath)).length > 0);
});

test("output is local, confined to its explicit directory, and never overwrites files", async () => {
  const request = await input();
  for (const fileName of ["../escaped.pptx", "..\\escaped.pptx", "report.pdf", "C:\\elsewhere.pptx", "report.pptx:stream", "CON.pptx"]) {
    await assert.rejects(new NativeCreateAdapter().generate({ ...request, fileName }), /file name/i);
  }
  for (const outputDirectory of ["", "relative", "https://example.com", "\\\\server\\share"]) {
    await assert.rejects(new NativeCreateAdapter().generate({ ...request, outputDirectory }), /local|absolute|directory/i);
  }
  await writeFile(join(request.outputDirectory, request.fileName), "existing file");
  await assert.rejects(new NativeCreateAdapter().generate(request), /EEXIST/);
  assert.equal(await readFile(join(request.outputDirectory, request.fileName), "utf8"), "existing file");
  assert.deepEqual(await readdir(request.outputDirectory), ["report.pptx"]);
});
