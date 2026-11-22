import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  OBSERVER_IDS,
  createObservationTask,
  type ObservationInput,
  type ObserverId,
} from "../runtime/src/observers/catalog.js";
import { normalizeObservation } from "../runtime/src/observers/normalize.js";

const input = {
  companyId: "example-company",
  level: "slide" as const,
  sourceIds: ["deck-001"],
};

const context = {
  observerId: "typography" as const,
  coverage: 0.75,
  missingCapabilities: ["imageAnalysis" as const],
  unknownFields: ["rendered_font_appearance"],
};

const evidence = {
  source_id: "deck-001",
  slide_number: 3,
  element_ref: "shape-7",
  source_type: "pptx-structure",
  locator: "ppt/slides/slide3.xml#shape-7",
};

test("observer catalog contains exactly the nine distinct contracts in execution order", () => {
  assert.deepEqual(OBSERVER_IDS, [
    "style-classifier",
    "typography",
    "visual-style",
    "layout",
    "master-template",
    "table",
    "chart",
    "visual-asset",
    "content",
  ]);
  assert.equal(new Set(OBSERVER_IDS).size, 9);
});

test("observation tasks identify a local prompt contract without embedding a model adapter", () => {
  const task = createObservationTask("typography", input);

  assert.deepEqual(toPlainData(task), {
    observerId: "typography",
    promptReference:
      ".cursor/skills/enterprise-ppt-multistyle/references/observers/typography.md",
    input,
  });
  assert.equal("provider" in task, false);
  assert.equal("model" in task, false);
  assert.equal("run" in task, false);
});

test("observation task construction rejects unknown observers and unscoped inputs", () => {
  assert.throws(
    () => createObservationTask("not-an-observer" as ObserverId, input),
    /observer/i,
  );
  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        companyId: "",
      }),
    /companyId/i,
  );
  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        sourceIds: [],
      }),
    /sourceIds/i,
  );
});

test("observation task construction rejects provider and execution leakage at any depth", () => {
  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        model: "provider-model",
      } as ObservationInput),
    /model/i,
  );
  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        structuralFacts: {
          slides: [{ provider: "external-provider" }],
        },
      }),
    /provider/i,
  );
  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        structuralFacts: {
          slides: [{ inspect: () => "orchestrated" }],
        },
      }),
    /function/i,
  );
});

test("observation tasks retain an isolated immutable snapshot of caller input", () => {
  const sourceIds = ["deck-001"];
  const renderedAssets = ["slides/1.png"];
  const structuralFacts = { slides: [{ title: "Original" }] };
  const capabilities = {
    pptxRead: true,
    pptxWrite: false,
    renderSlides: true,
    imageAnalysis: false,
    parallelAgents: false,
  };
  const mutableInput = {
    companyId: "example-company",
    level: "slide" as const,
    sourceIds,
    renderedAssets,
    structuralFacts,
    capabilities,
  };

  const task = createObservationTask("typography", mutableInput);
  mutableInput.companyId = "other-company";
  sourceIds[0] = "other-deck";
  renderedAssets[0] = "other.png";
  structuralFacts.slides[0]!.title = "Mutated";
  capabilities.imageAnalysis = true;

  assert.deepEqual(toPlainData(task.input), {
    companyId: "example-company",
    level: "slide",
    sourceIds: ["deck-001"],
    renderedAssets: ["slides/1.png"],
    structuralFacts: { slides: [{ title: "Original" }] },
    capabilities: {
      pptxRead: true,
      pptxWrite: false,
      renderSlides: true,
      imageAnalysis: false,
      parallelAgents: false,
    },
  });
  assert.equal(Object.isFrozen(task), true);
  assert.equal(Object.isFrozen(task.input), true);
  assert.equal(Object.isFrozen(task.input.sourceIds), true);
  assert.equal(Object.isFrozen(task.input.structuralFacts), true);
  assert.equal(task.input.sourceIds.includes("deck-001"), true);
});

test("observation task construction rejects changing accessors without invoking them", () => {
  let accessorReads = 0;
  const accessorInput = {
    companyId: "example-company",
    level: "slide" as const,
  } as ObservationInput;
  Object.defineProperty(accessorInput, "sourceIds", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return accessorReads < 4
        ? ["deck-001"]
        : ["deck-001", () => "provider-execution"];
    },
  });

  assert.throws(
    () => createObservationTask("typography", accessorInput),
    /accessor|data field/i,
  );
  assert.equal(accessorReads, 0);

  let nestedAccessorReads = 0;
  const slides: unknown[] = [];
  Object.defineProperty(slides, 0, {
    enumerable: true,
    configurable: true,
    get() {
      nestedAccessorReads += 1;
      return nestedAccessorReads === 1
        ? { title: "Benign" }
        : { provider: "external", execute: () => "leaked" };
    },
  });
  slides.length = 1;

  assert.throws(
    () =>
      createObservationTask("typography", {
        ...input,
        structuralFacts: { slides },
      }),
    /accessor|data field/i,
  );
  assert.equal(nestedAccessorReads, 0);
});

test("observation task snapshots are independent of mutable built-in prototypes", () => {
  const structuralFacts: Record<string, unknown> = {
    slides: [{ title: "Original" }],
  };
  Object.defineProperty(structuralFacts, "__proto__", {
    value: { label: "own-data" },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const task = createObservationTask("typography", {
    ...input,
    structuralFacts,
  });
  const objectProvider = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "provider",
  );
  const objectExecute = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "execute",
  );
  const arrayProvider = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "provider",
  );
  const arrayRun = Object.getOwnPropertyDescriptor(Array.prototype, "run");

  try {
    Object.defineProperty(Object.prototype, "provider", {
      value: "polluted-provider",
      configurable: true,
    });
    Object.defineProperty(Object.prototype, "execute", {
      value: () => "polluted-execution",
      configurable: true,
    });
    Object.defineProperty(Array.prototype, "provider", {
      value: "polluted-array-provider",
      configurable: true,
    });
    Object.defineProperty(Array.prototype, "run", {
      value: () => "polluted-array-execution",
      configurable: true,
    });

    const taskRecord = task as unknown as Record<string, unknown>;
    const inputRecord = task.input as unknown as Record<string, unknown>;
    const facts = task.input.structuralFacts as Record<string, unknown>;
    const slide = (facts.slides as Array<Record<string, unknown>>)[0]!;
    const sources = task.input.sourceIds as unknown as Record<string, unknown>;

    assert.equal(taskRecord.provider, undefined);
    assert.equal(taskRecord.execute, undefined);
    assert.equal(inputRecord.provider, undefined);
    assert.equal(facts.provider, undefined);
    assert.equal(slide.execute, undefined);
    assert.equal(sources.provider, undefined);
    assert.equal(sources.run, undefined);
    assert.equal(Object.getPrototypeOf(task), null);
    assert.equal(Object.getPrototypeOf(task.input), null);
    assert.equal(Object.getPrototypeOf(facts), null);
    assert.notEqual(Object.getPrototypeOf(task.input.sourceIds), Array.prototype);
    assert.equal(Object.hasOwn(facts, "__proto__"), true);
    assert.deepEqual(toPlainData(facts.__proto__), { label: "own-data" });
  } finally {
    restoreDescriptor(Object.prototype, "provider", objectProvider);
    restoreDescriptor(Object.prototype, "execute", objectExecute);
    restoreDescriptor(Array.prototype, "provider", arrayProvider);
    restoreDescriptor(Array.prototype, "run", arrayRun);
  }
});

test("task arrays exclude pollution present before module initialization", () => {
  // A fresh process ensures the static import above cannot satisfy this import.
  const catalogUrl = new URL("../runtime/src/observers/catalog.ts", import.meta.url);
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    Object.defineProperty(Array.prototype, "provider", {
      value: "before-import", configurable: true,
    });
    Object.defineProperty(Array.prototype, "run", {
      value: () => "before-import", configurable: true,
    });
    let createObservationTask;
    try {
      ({ createObservationTask } = await import(${JSON.stringify(catalogUrl.href)}));
    } finally {
      delete Array.prototype.provider;
      delete Array.prototype.run;
    }
    const task = createObservationTask("typography", {
      companyId: "example-company", level: "slide", sourceIds: ["deck-001"],
      renderedAssets: ["slides/1.png"], structuralFacts: { rows: [["nested"]] },
    });
    for (const array of [task.input.sourceIds, task.input.renderedAssets,
      task.input.structuralFacts.rows, task.input.structuralFacts.rows[0]]) {
      assert.equal("provider" in array, false);
      assert.equal("run" in array, false);
      assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(array)), null);
      assert.equal(Object.isFrozen(array), true);
    }
  `], { stdio: "pipe" });
});

test("task arrays inherit no shared mutable descriptor values or mutators", () => {
  const sources = createObservationTask("typography", input).input.sourceIds;
  const prototype = Object.getPrototypeOf(sources) as Record<PropertyKey, unknown>;
  assert.equal(prototype[Symbol.unscopables], undefined);
  assert.equal(prototype.constructor, undefined);
  for (const name of ["push", "pop", "splice", "sort", "reverse", "fill", "copyWithin"]) {
    assert.equal(prototype[name], undefined);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(prototype))) {
    assert.equal(typeof descriptor.value, "function");
    assert.equal(Object.isFrozen(descriptor.value), true);
    assert.equal(Object.getPrototypeOf(descriptor.value), null);
  }
  assert.notEqual(prototype.includes, Array.prototype.includes);
  const unscopables = Array.prototype[Symbol.unscopables] as Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptor(unscopables, "provider");
  try {
    Object.defineProperty(unscopables, "provider", {
      value: "shared-mutation", configurable: true,
    });
    assert.equal(prototype[Symbol.unscopables], undefined);
  } finally {
    restoreDescriptor(unscopables, "provider", previous);
  }
});

test("readonly array methods preserve isolated results under prototype pollution", () => {
  const sources = createObservationTask("typography", input).input.sourceIds;
  const previousProvider = Object.getOwnPropertyDescriptor(Array.prototype, "provider");
  const previousRun = Object.getOwnPropertyDescriptor(Array.prototype, "run");
  try {
    Object.defineProperty(Array.prototype, "provider", {
      value: "polluted-provider", configurable: true,
    });
    Object.defineProperty(Array.prototype, "run", {
      value: () => "polluted-run", configurable: true,
    });
    const mapped = sources.map((source) => [source]);
    const results = [sources.slice(), sources.filter(Boolean), mapped, mapped[0]!,
      sources.entries().next().value!];
    for (const result of results) {
      assert.equal("provider" in result, false);
      assert.equal("run" in result, false);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(result)), null);
    }
    assert.deepEqual(toPlainData(mapped), [["deck-001"]]);
    assert.deepEqual([...sources], ["deck-001"]);
    assert.deepEqual([...sources.keys()], [0]);
    const iterator = sources.values();
    assert.equal(Object.getPrototypeOf(iterator), null);
    assert.equal(Object.isFrozen(iterator), true);
    const step = iterator.next();
    assert.equal(Object.getPrototypeOf(step), null);
    assert.equal(Object.isFrozen(step), true);
    assert.equal(step.value, "deck-001");
    assert.equal(iterator.next().done, true);
    assert.equal(sources.includes("deck-001"), true);
    assert.equal(sources.join(","), "deck-001");
    assert.equal(sources.some((source) => source === "deck-001"), true);
    assert.equal(sources.slice().map((source) => source.toUpperCase())[0], "DECK-001");
    assert.throws(() => sources.map(() => ({ provider: "callback-provider" })), /provider/i);
  } finally {
    restoreDescriptor(Array.prototype, "provider", previousProvider);
    restoreDescriptor(Array.prototype, "run", previousRun);
  }
});

test("normalization rejects a claimed fact without evidence", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-001",
      category: "typography",
      fact: "Titles use a sans-serif typeface",
      evidence: [],
      confidence: 0.9,
    },
    context,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.coverage, 0.75);
  assert.deepEqual(result.missing_capabilities, ["imageAnalysis"]);
  assert.deepEqual(result.unknown_fields, ["rendered_font_appearance"]);
});

test("normalization rejects malformed evidence and invalid confidence", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-002",
      category: "typography",
      fact: "Body copy uses a regular weight",
      evidence: [{ ...evidence, locator: "" }],
      confidence: 1.1,
    },
    context,
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 1);
});

test("normalization emits a contract-valid observation with degradation metadata", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-003",
      category: "typography",
      fact: "Titles use a sans-serif typeface",
      evidence: [evidence],
      confidence: 0.9,
    },
    context,
  );

  assert.deepEqual(result, {
    ok: true,
    observation: {
      observation_id: "obs-003",
      category: "typography",
      fact: "Titles use a sans-serif typeface",
      evidence: [evidence],
      confidence: 0.9,
      agent_id: "typography",
      coverage: 0.75,
      missing_capabilities: ["imageAnalysis"],
      unknown_fields: ["rendered_font_appearance"],
    },
    coverage: 0.75,
    missing_capabilities: ["imageAnalysis"],
    unknown_fields: ["rendered_font_appearance"],
    errors: [],
  });
});

test("normalization rejects an observer result in another contract category", () => {
  const result = normalizeObservation(
    {
      observation_id: "obs-004",
      category: "layout",
      fact: "Titles use a sans-serif typeface",
      evidence: [evidence],
      confidence: 0.9,
    },
    context,
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /category/i);
});

test("normalization preserves model uncertainty and unions capability-derived gaps", () => {
  const raw = {
    observation_id: "partial", category: "typography", fact: "Font family is UNKNOWN",
    evidence: [evidence], confidence: 0.4, coverage: 0.2,
    unknown_fields: ["font_family"], missing_capabilities: ["pptxRead"],
  };
  for (const runtimeContext of [context, { ...context, coverage: 1, missingCapabilities: [], unknownFields: [] }]) {
    const result = normalizeObservation(raw, runtimeContext);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.observation.coverage, 0.2);
    assert.equal(result.observation.unknown_fields.includes("font_family"), true);
    assert.equal(result.observation.missing_capabilities.includes("pptxRead"), true);
    assert.equal(result.observation.unknown_fields.includes("rendered_font_appearance"), runtimeContext === context);
  }
  const optimistic = normalizeObservation({ ...raw, coverage: 1 }, context);
  assert.equal(optimistic.coverage, 0.75);
});

test("normalization rejects invalid or unbounded model uncertainty", () => {
  const raw = { observation_id: "invalid", category: "typography", fact: "Font family is UNKNOWN", evidence: [evidence], confidence: 0.4 };
  const invalid = [
    { coverage: -0.1 }, { coverage: 1.1 }, { coverage: NaN }, { coverage: "0.2" },
    { missing_capabilities: ["invented"] }, { missing_capabilities: "pptxRead" },
    { unknown_fields: [""] }, { unknown_fields: ["   "] }, { unknown_fields: [42] },
    { unknown_fields: ["x".repeat(257)] }, { unknown_fields: Array.from({ length: 129 }, (_, i) => `field-${i}`) },
  ];
  for (const metadata of invalid) {
    assert.equal(normalizeObservation({ ...raw, ...metadata }, context).ok, false, JSON.stringify(metadata));
  }
});

test("normalization rejects uncertainty iterators without invoking or draining them", () => {
  const raw = { observation_id: "iterator", category: "typography", fact: "Partial font data", evidence: [evidence], confidence: 0.4 };
  for (const field of ["unknown_fields", "missing_capabilities"] as const) {
    for (const mode of ["erase", "unbounded"] as const) {
      let iteratorCalls = 0;
      const values = [field === "unknown_fields" ? "font_family" : "pptxRead"];
      Object.defineProperty(values, Symbol.iterator, {
        value() {
          iteratorCalls++;
          if (mode === "unbounded") throw new Error("An unbounded iterator must never start");
          return [][Symbol.iterator]();
        },
      });
      const result = normalizeObservation({ ...raw, [field]: values }, context);
      assert.equal(result.ok, false, `${field}: ${mode}`);
      assert.equal(iteratorCalls, 0);
    }
  }
});

test("normalization rejects changing uncertainty getters without reading them", () => {
  const raw = { observation_id: "getter", category: "typography", fact: "Partial font data", evidence: [evidence], confidence: 0.4 };
  for (const field of ["coverage", "unknown_fields", "missing_capabilities"] as const) {
    let reads = 0;
    const payload = { ...raw };
    Object.defineProperty(payload, field, {
      get() { reads++; return field === "coverage" ? (reads === 1 ? 0.2 : 1) : []; },
    });
    const result = normalizeObservation(payload, { ...context, coverage: 1 });
    assert.equal(result.ok, false, field);
    assert.equal(reads, 0);
  }
});

test("uncertainty snapshots reject array accessors, custom prototypes, and oversized sparse arrays", () => {
  const raw = { observation_id: "array-data", category: "typography", fact: "Partial font data", evidence: [evidence], confidence: 0.4 };
  let reads = 0;
  const accessor = ["font_family"];
  Object.defineProperty(accessor, "0", { get() { reads++; return "font_family"; } });
  const inheritedIterator = ["font_family"];
  Object.setPrototypeOf(inheritedIterator, Object.assign(Object.create(Array.prototype), {
    [Symbol.iterator]() { reads++; return [][Symbol.iterator](); },
  }));
  const proxy = new Proxy(["font_family"], {
    getPrototypeOf() { reads++; throw new Error("Proxy behavior must not run"); },
    getOwnPropertyDescriptor() { reads++; throw new Error("Proxy behavior must not run"); },
  });
  for (const unknown_fields of [accessor, inheritedIterator, proxy, new Array(129)]) {
    const result = normalizeObservation({ ...raw, unknown_fields }, context);
    assert.equal(result.ok, false);
    assert.equal(reads, 0);
  }
});

test("uncertainty snapshots retain gaps when a later fact getter replaces the global array iterator", () => {
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  let iteratorCalls = 0;
  const raw = {
    observation_id: "prototype-iterator", category: "typography",
    evidence: [evidence], confidence: 0.4, coverage: 0.2,
    missing_capabilities: ["pptxRead"], unknown_fields: ["font_family"],
    get fact() {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value() { iteratorCalls++; return { next: () => ({ done: true, value: undefined }) }; },
      });
      return "Partial font data";
    },
  };
  let result: ReturnType<typeof normalizeObservation>;
  try {
    result = normalizeObservation(raw, context);
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, previous);
  }
  assert.equal(result.ok, true);
  assert.deepEqual(result.unknown_fields, ["rendered_font_appearance", "font_family"]);
  assert.deepEqual(result.missing_capabilities, ["imageAnalysis", "pptxRead"]);
  assert.equal(result.coverage, 0.2);
  assert.equal(iteratorCalls, 0);
});

test("normalization returns a failure for a revoked root proxy without throwing", () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const result = normalizeObservation(proxy, context);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length > 0, true);
});

function restoreDescriptor(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, key);
  } else {
    Object.defineProperty(target, key, descriptor);
  }
}

function toPlainData(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
