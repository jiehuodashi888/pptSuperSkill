import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { runFixtureWorkflow, type FixtureWorkflowOptions } from "../runtime/src/workflow/fixture.js";
import { fetchPublicFixture } from "../scripts/fetch-public-fixture.js";

async function options(): Promise<FixtureWorkflowOptions> {
  const root = await mkdtemp(join(tmpdir(), "ppt-workflow-"));
  await cp(resolve("instances/example-company"), join(root, "example-company"), { recursive: true });
  const fixturePath = join(root, "fixture.json");
  await writeFile(fixturePath, JSON.stringify({
    sourceId: "synthetic-fixture",
    structuralFacts: { title: "Local fixture" },
    request: { businessType: "report", audience: "board", department: "finance", deliveryContext: "meeting" },
    library: { styles: [{ ref: "synthetic-style", status: "approved", businessTypes: ["report"], audiences: ["board"], departments: ["finance"], deliveryContexts: ["meeting"], tags: [], templateRefs: [] }], approvedMappings: [] },
    pagePlan: {
      styleRef: "synthetic-style",
      tokens: { status: "approved", width: 10, height: 5.625, backgroundColor: "FFFFFF", titleColor: "112233", bodyColor: "334455", titleFontFace: "Arial", bodyFontFace: "Arial", titleFontSize: 30, bodyFontSize: 18 },
      layouts: [{ id: "basic", status: "approved", title: { x: 1, y: 1, w: 8, h: 1 }, body: { x: 1, y: 3, w: 8, h: 2 } }],
      slides: [{ layoutId: "basic", title: "Local fixture", body: "Editable test content" }],
    },
  }));
  return {
    instancesRoot: root, companyId: "example-company", fixturePath,
    outputDirectory: join(root, "output"), fileName: "fixture.pptx",
    capabilities: { pptxRead: true, pptxWrite: true, renderSlides: false, imageAnalysis: false, parallelAgents: false },
    modelAdapter: { async run(task) {
      return { observation_id: `fixture-${task.observerId}`, category: task.observerId, fact: "Local synthetic input only", confidence: 0.9,
        evidence: [{ source_id: task.input.sourceIds[0], slide_number: 1, element_ref: "title", source_type: "synthetic-test", locator: "fixture.json#title" }] };
    } },
    qa: { structural: { async inspect(deckPath) {
      const zip = await JSZip.loadAsync(await readFile(deckPath), { checkCRC32: true });
      assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /<a:t>Local fixture<\/a:t>/);
      return { checkedSlides: [1], findings: [], gaps: ["Only editable title structure checked; enterprise rules were not evaluated"] };
    } } },
  };
}

test("local fixture wires observations and approved routing into native generation and honest QA", async () => {
  const input = await options();
  const report = await runFixtureWorkflow(input);
  assert.equal(report.generatedDeck.status, "created");
  assert.equal(report.observationRun.results.length, 9);
  assert.equal(report.observationRun.executionMode, "serial");
  assert.equal(report.observationRun.results.every((item) => item.ok), true);
  assert.deepEqual(report.routing.selectedStyleRefs, ["synthetic-style"]);
  const zip = await JSZip.loadAsync(await readFile(report.generatedDeck.outputPath));
  assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /Editable test content/);
  assert.equal(report.audit.complete, false);
  assert.equal(report.audit.status, "incomplete");
  assert.equal(report.audit.structural.status, "incomplete");
  assert.equal(report.audit.visual.status, "not-run");
  assert.match(report.audit.coverage.gaps.join("\n"), /imageAnalysis/);
  assert.match(report.audit.coverage.gaps.join("\n"), /enterprise rules/);
  assert.deepEqual(await readdir(join(input.instancesRoot, input.companyId, "styles")), ["default"]);
});

test("fixture workflow stops ambiguous routing before writing a deck", async () => {
  const input = await options();
  const fixture = JSON.parse(await readFile(input.fixturePath, "utf8"));
  fixture.request = {};
  await writeFile(input.fixturePath, JSON.stringify(fixture));
  await assert.rejects(runFixtureWorkflow(input), /confirmation/i);
  await assert.rejects(readFile(join(input.outputDirectory, input.fileName)), /ENOENT/);
});

test("fixture paths reject network and Windows device syntax before any filesystem lookup", async () => {
  const input = await options();
  // A deliberately absent LOCAL instance stops the old implementation before
  // it could touch a network fixture path. Validation must instead fail first.
  const instancesRoot = join(input.instancesRoot, "absent-local-instances");
  const paths = [
    "\\\\server.invalid\\share\\fixture.json", "//server.invalid/share/fixture.json",
    "\\\\?\\C:\\fixture.json", "\\\\?\\UNC\\server.invalid\\share\\fixture.json",
    "\\\\.\\pipe\\fixture", "//./pipe/fixture", "\\??\\C:\\fixture.json",
    ...(process.platform === "win32" ? ["\\fixture.json", "/fixture.json", "C:fixture.json", "C:\\fixture.json:stream", "C:\\NUL.json"] : []),
  ];
  for (const fixturePath of paths) {
    await assert.rejects(runFixtureWorkflow({ ...input, instancesRoot, fixturePath }), /fixture path.*local absolute/i, fixturePath);
  }
});

test("structural errors preserve failed audit status while visual coverage remains incomplete", async () => {
  const input = await options();
  const report = await runFixtureWorkflow({ ...input, qa: { structural: { async inspect() {
    return { checkedSlides: [1], findings: [{ finding_id: "structural-error", severity: "error", rule_ref: "fixture-rule", repairability: "none", recommended_fix: null,
      evidence: [{ source_id: "synthetic-fixture", slide_number: 1, element_ref: "title", source_type: "synthetic-test", locator: "ppt/slides/slide1.xml#title" }] }] };
  } } } });
  assert.equal(report.audit.status, "failed");
  assert.equal(report.audit.structural.status, "failed");
  assert.equal(report.audit.complete, false);
  assert.equal(report.audit.visual.status, "not-run");
  assert.match(report.audit.coverage.gaps.join("\n"), /imageAnalysis/);
});

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "runtime/src/index.ts", ...args], { encoding: "utf8" });
}

test("validate-instance CLI validates declared asset containment and missing assets", async () => {
  const input = await options();
  const instance = join(input.instancesRoot, input.companyId);
  const valid = cli("validate-instance", instance);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).companyId, "example-company");
  await writeFile(join(instance, "instance.yaml"), JSON.stringify({ company_id: "example-company", core_version: "0.1.0", assets: ["missing.json"] }));
  assert.equal(cli("validate-instance", instance).status, 1);
  await writeFile(join(instance, "instance.yaml"), JSON.stringify({ company_id: "example-company", core_version: "0.1.0", assets: ["../fixture.json"] }));
  assert.equal(cli("validate-instance", instance).status, 1);
  assert.equal(cli("validate-instance").status, 1);
});

test("fetch CLI requires both explicit URL and confirmation before any acquisition", () => {
  for (const args of [[], ["--url", "https://example.invalid/a.pptx"], ["--confirm"], ["--url", "file:///tmp/a", "--confirm"]]) {
    const result = cli("fetch-public-fixture", ...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /URL|confirm|HTTP/i);
  }
});

test("fixture acquisition records exact bytes provenance without accessing the network", async () => {
  const input = await options();
  const bytes = Buffer.from("synthetic download payload");
  const result = await fetchPublicFixture({ instanceDirectory: join(input.instancesRoot, input.companyId), url: "https://example.invalid/fixture.pptx", confirm: true, name: "sample", purpose: "Parser regression only", licenseUseNote: "Synthetic response; no public content retrieved" }, async (url, init) => {
    assert.equal(url, "https://example.invalid/fixture.pptx");
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    return new Response(bytes);
  });
  assert.deepEqual(await readFile(result.fixturePath), bytes);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), ["classification", "fixture_file", "license_use_note", "purpose", "retrieved_at", "sha256", "url"]);
  assert.equal(manifest.url, "https://example.invalid/fixture.pptx");
  assert.equal(manifest.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(manifest.classification, "test-only");
  assert.ok(Number.isFinite(Date.parse(manifest.retrieved_at)));
  assert.equal(manifest.purpose, "Parser regression only");
  assert.equal(manifest.license_use_note, "Synthetic response; no public content retrieved");
  assert.equal(manifest.fixture_file, "sample.bin");
});

test("fixture acquisition rejects unsafe inputs, overwrite and linked test directories", async () => {
  const input = await options();
  const base = { instanceDirectory: join(input.instancesRoot, input.companyId), url: "https://example.invalid/f", confirm: true, name: "sample", purpose: "test", licenseUseNote: "test data" };
  const forbiddenTransport = async (): Promise<Response> => { assert.fail("Invalid request reached transport"); };
  for (const change of [{ confirm: false }, { url: "" }, { url: "file:///tmp/x" }, { url: "https://user:secret@example.invalid/x" }, { name: "../escape" }, { name: "a:stream" }, { name: "CON" }, { purpose: " " }, { licenseUseNote: "" }]) {
    await assert.rejects(fetchPublicFixture({ ...base, ...change }, forbiddenTransport));
  }
  await fetchPublicFixture(base, async () => new Response("first"));
  await assert.rejects(fetchPublicFixture(base, forbiddenTransport), /exist/i);
  const second = await options();
  const outside = await mkdtemp(join(tmpdir(), "ppt-fixture-outside-"));
  const target = join(second.instancesRoot, second.companyId, "tests", "public-fixtures");
  await symlink(outside, target, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(fetchPublicFixture({ ...base, instanceDirectory: join(second.instancesRoot, second.companyId) }, forbiddenTransport), /link|junction/i);
  assert.deepEqual(await readdir(outside), []);
});

test("fixture acquisition refuses redirects and failed HTTP responses without publishing provenance", async () => {
  const input = await options();
  const base = { instanceDirectory: join(input.instancesRoot, input.companyId), url: "https://example.invalid/f", confirm: true, name: "sample", purpose: "test", licenseUseNote: "test data" };
  for (const status of [302, 404]) {
    await assert.rejects(fetchPublicFixture(base, async () => new Response("bad", { status })), /HTTP|redirect/i);
  }
  assert.deepEqual(await readdir(join(base.instanceDirectory, "tests", "public-fixtures")), []);
});

test("fixture acquisition rejects literal fragment delimiters including empty fragments", async () => {
  const input = await options();
  for (const url of ["https://example.invalid/f#", "https://example.invalid/f#part"]) {
    await assert.rejects(fetchPublicFixture({ instanceDirectory: join(input.instancesRoot, input.companyId), url, confirm: true, name: "fragment", purpose: "test", licenseUseNote: "synthetic" }, async () => {
      assert.fail("Fragment URL reached transport");
    }), /without credentials or fragments/i);
  }
});
