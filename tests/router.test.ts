import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  requireApprovedRoute,
  routeScenario,
  routeProtectedScenario,
  requireProtectedRoute,
  type GenerationRequest,
  type StyleLibrary,
} from "../runtime/src/routing/router.js";

const library: StyleLibrary = {
  styles: [
    {
      ref: "styles/business-formal",
      status: "approved",
      businessTypes: ["annual-report", "quarterly-review"],
      audiences: ["executive", "board"],
      departments: ["finance", "operations"],
      deliveryContexts: ["board-meeting", "live-presentation"],
      tags: ["formal", "data-led"],
      templateRefs: ["templates/business-formal.potx"],
    },
    {
      ref: "styles/team-update",
      status: "approved",
      businessTypes: ["project-update"],
      audiences: ["internal-team"],
      departments: ["engineering", "operations"],
      deliveryContexts: ["live-presentation"],
      tags: ["concise", "status"],
      templateRefs: ["templates/team-update.potx"],
    },
    {
      ref: "styles/unapproved-experiment",
      status: "candidate",
      businessTypes: ["annual-report"],
      audiences: ["executive"],
      departments: ["finance"],
      deliveryContexts: ["board-meeting"],
      tags: ["formal", "data-led"],
      templateRefs: ["templates/unapproved-experiment.potx"],
    },
  ],
  approvedMappings: [
    {
      mappingId: "annual-executive-report",
      styleRef: "styles/business-formal",
      businessType: "annual-report",
      audience: "executive",
      department: "finance",
      deliveryContext: "board-meeting",
      tags: ["formal"],
      status: "approved",
    },
  ],
};

const annualReport: GenerationRequest = {
  businessType: "annual-report",
  audience: "executive",
  department: "finance",
  deliveryContext: "board-meeting",
  explicitTags: ["formal", "data-led"],
};

const ambiguousRequest: GenerationRequest = {};

test("legacy libraries and legacy issued approvals remain test-only", () => {
  // Runtime rejection is necessary even if an untyped caller ignores TS types.
  assert.throws(() => routeProtectedScenario(annualReport, library as never), /authentic|registered/i);
  const legacy = requireApprovedRoute(routeScenario(annualReport, library));
  assert.throws(() => requireProtectedRoute(legacy as never), /authentic|protected/i);
});

test("routes a known annual report to an approved style with explainable evidence", () => {
  const decision = routeScenario(annualReport, library);

  assert.equal(decision.selectedStyleRefs[0], "styles/business-formal");
  assert.equal(decision.requires_confirmation, false);
  assert.equal(decision.candidates[0]?.styleRef, "styles/business-formal");
  assert.ok(decision.candidates[0]?.evidence.includes("business_type:annual-report"));
  assert.ok(decision.candidates[0]?.evidence.includes("audience:executive"));
  assert.ok(decision.candidates[0]?.evidence.includes("department:finance"));
  assert.ok(decision.candidates[0]?.evidence.includes("delivery_context:board-meeting"));
  assert.ok(decision.candidates[0]?.evidence.includes("tag:formal"));
  assert.ok(
    decision.candidates[0]?.evidence.includes(
      "approved_mapping:annual-executive-report",
    ),
  );
  assert.ok(decision.confidence >= 0.8);
});

test("an ambiguous route requires confirmation and cannot become generation input", () => {
  const decision = routeScenario(ambiguousRequest, library);

  assert.equal(decision.requires_confirmation, true);
  assert.deepEqual(decision.selectedStyleRefs, []);
  assert.throws(() => requireApprovedRoute(decision), /confirmation/i);
});

test("the approval gate returns only approved, library-backed generation references", () => {
  const decision = routeScenario(annualReport, library);
  const approved = requireApprovedRoute(decision);

  assert.deepEqual(approved.styleRefs, ["styles/business-formal"]);
  assert.deepEqual(approved.templateRefs, ["templates/business-formal.potx"]);
  assert.equal(approved.confidence, decision.confidence);
});

test("routing never synthesizes a requested style or selects a candidate entry", () => {
  const decision = routeScenario(
    {
      businessType: "annual-report",
      audience: "executive",
      department: "finance",
      deliveryContext: "board-meeting",
      explicitTags: ["invented-premium-style"],
    },
    library,
  );

  assert.ok(
    decision.candidates.every((candidate) =>
      library.styles.some(
        (style) => style.status === "approved" && style.ref === candidate.styleRef,
      ),
    ),
  );
  assert.ok(!decision.selectedStyleRefs.includes("invented-premium-style"));
  assert.ok(!decision.selectedStyleRefs.includes("styles/unapproved-experiment"));
});

test("unknown facts with too little evidence require confirmation", () => {
  const decision = routeScenario({ explicitTags: ["concise"] }, library);

  assert.equal(decision.requires_confirmation, true);
  assert.equal(decision.candidates[0]?.styleRef, "styles/team-update");
  assert.deepEqual(decision.selectedStyleRefs, []);
  assert.throws(() => requireApprovedRoute(decision), /confirmation/i);
});

test("a predicate-free approved mapping cannot route an empty request", () => {
  const decision = routeScenario({}, {
    styles: [library.styles[0]],
    approvedMappings: [
      {
        mappingId: "empty-mapping",
        styleRef: "styles/business-formal",
        status: "approved",
      },
    ],
  });

  assert.equal(decision.requires_confirmation, true);
  assert.deepEqual(decision.selectedStyleRefs, []);
  assert.equal(decision.confidence, 0);
  assert.ok(
    !decision.candidates[0]?.evidence.includes(
      "approved_mapping:empty-mapping",
    ),
  );
  assert.throws(() => requireApprovedRoute(decision), /confirmation/i);
});

test("whitespace-only mapping predicates cannot match whitespace request facts", () => {
  const decision = routeScenario(
    {
      businessType: "  ",
      audience: "\t",
      department: "\r\n",
      deliveryContext: " ",
      explicitTags: ["  ", "\t"],
    },
    {
      styles: [library.styles[0]],
      approvedMappings: [
        {
          mappingId: "whitespace-mapping",
          styleRef: "styles/business-formal",
          businessType: "  ",
          audience: "\t",
          department: "\r\n",
          deliveryContext: " ",
          tags: ["  ", "\t"],
          status: "approved",
        },
      ],
    },
  );

  assert.equal(decision.requires_confirmation, true);
  assert.deepEqual(decision.selectedStyleRefs, []);
  assert.equal(decision.confidence, 0);
  assert.ok(
    !decision.candidates[0]?.evidence.includes(
      "approved_mapping:whitespace-mapping",
    ),
  );
});

test("example scenario mappings are generic and point to approved library styles", async () => {
  const mappingDocument = JSON.parse(
    await readFile(
      new URL(
        "../instances/example-company/scenarios/scenario-style-map.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { mappings: StyleLibrary["approvedMappings"] };

  assert.ok(mappingDocument.mappings.length > 0);
  assert.ok(mappingDocument.mappings.every((mapping) => mapping.status === "approved"));
  assert.ok(
    mappingDocument.mappings.every((mapping) =>
      library.styles.some(
        (style) => style.status === "approved" && style.ref === mapping.styleRef,
      ),
    ),
  );
});
