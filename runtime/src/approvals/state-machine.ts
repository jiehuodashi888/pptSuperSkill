import { readFileSync } from "node:fs";

import Ajv, { type ValidateFunction } from "ajv";

import {
  isIssuedApprovalRequest,
  type ApprovalRequest,
  type TaxonomyChange,
  type TaxonomyEntry,
} from "../contracts/taxonomy.js";

export type ApprovalState =
  | ApprovalRequest
  | (Omit<ApprovalRequest, "status"> & {
      readonly status: "approved" | "rejected";
    });

export type ApprovalDecision =
  | { action: "approve" }
  | { action: "reject"; reason?: string }
  | { action: "publish" }
  | { action: "rename"; newName: string }
  | { action: "merge"; target_ids: string[] }
  | { action: "split"; entries: TaxonomyEntry[] }
  | { action: "deprecate" };

const approvalSchema = JSON.parse(
  readFileSync(
    new URL("../../schemas/approval.schema.json", import.meta.url),
    "utf8",
  ),
) as object;
const validateApprovalRequest: ValidateFunction = new Ajv.default({
  allErrors: true,
  strict: true,
}).compile(approvalSchema);
const decidedRequests = new WeakSet<object>();

export function applyApproval(
  state: ApprovalState,
  decision: ApprovalDecision,
): ApprovalState {
  if (decision.action !== "approve" && decision.action !== "reject") {
    throw new Error(
      `Taxonomy ${decision.action} requires an approved approval request`,
    );
  }

  if (state.status !== "candidate") {
    throw new Error(`Cannot decide an approval request in ${state.status} state`);
  }

  if (!validateApprovalRequest(state)) {
    const details = (validateApprovalRequest.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new Error(`Invalid approval request: ${details}`);
  }

  if (!isIssuedApprovalRequest(state)) {
    throw new Error("Approval requires an issued classification proposal");
  }

  if (decidedRequests.has(state)) {
    throw new Error("Approval request is already decided");
  }

  decidedRequests.add(state);

  return Object.freeze({
    ...state,
    status: decision.action === "approve" ? "approved" : "rejected",
    change: cloneChange(state.change),
    evidence: Object.freeze(
      state.evidence.map((item) => Object.freeze({ ...item })),
    ),
  });
}

function cloneChange(change: TaxonomyChange): TaxonomyChange {
  switch (change.action) {
    case "publish":
      return Object.freeze({ ...change, candidate: cloneEntry(change.candidate) });
    case "merge":
      return Object.freeze({
        ...change,
        source_ids: Object.freeze([...change.source_ids]),
        result: cloneEntry(change.result),
      });
    case "split":
      return Object.freeze({
        ...change,
        entries: Object.freeze(change.entries.map(cloneEntry)),
      });
    default:
      return Object.freeze({ ...change });
  }
}

function cloneEntry(entry: TaxonomyEntry): TaxonomyEntry {
  return Object.freeze({ ...entry, tags: Object.freeze([...entry.tags]) });
}
