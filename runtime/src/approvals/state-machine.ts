import { readFileSync } from "node:fs";

import Ajv, { type ValidateFunction } from "ajv";
import { assertResourceShareRequest, isIssuedResourceShareRequest, type ResourceShareRequest } from "./resource-sharing.js";

import {
  isIssuedApprovalRequest,
  type ApprovalRequest,
  type TaxonomyChange,
  type TaxonomyEntry,
} from "../contracts/taxonomy.js";

const terminalApprovalStateBrand: unique symbol = Symbol("terminalApprovalState");

export type TerminalApprovalState = Pick<
  ApprovalRequest,
  "request_id" | "change" | "evidence" | "proposed_by"
> & {
  readonly status: "approved" | "rejected";
  readonly [terminalApprovalStateBrand]: true;
};

export type ApprovalState = ApprovalRequest | TerminalApprovalState;

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
const authenticTerminalStates = new WeakSet<object>();

export type ResourceShareState = Omit<ResourceShareRequest, "status"> & { readonly status: "approved" | "rejected" };

/** Local share decisions are single-use review results, never taxonomy/core publication authority. */
export function applyResourceShareApproval(request: ResourceShareRequest, decision: ApprovalDecision): ResourceShareState {
  if (decision.action !== "approve" && decision.action !== "reject") throw new Error("Resource sharing permits approve or reject only");
  assertResourceShareRequest(request, request.companyId);
  if (!isIssuedResourceShareRequest(request)) throw new Error("Resource sharing requires an issued proposal");
  if (decidedRequests.has(request)) throw new Error("Approval request is already decided");
  decidedRequests.add(request);
  // Issued requests and every nested field are already frozen by the proposer.
  return Object.freeze({ ...request, status: decision.action === "approve" ? "approved" : "rejected" });
}

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

  const terminalData = {
    ...state,
    status: decision.action === "approve" ? "approved" : "rejected",
    change: cloneChange(state.change),
    evidence: Object.freeze(
      state.evidence.map((item) => Object.freeze({ ...item })),
    ),
  } as const;
  const terminalState = markTerminalState(terminalData);
  authenticTerminalStates.add(terminalState);
  return Object.freeze(terminalState);
}

export function isAuthenticTerminalApprovalState(
  value: unknown,
): value is TerminalApprovalState {
  return (
    typeof value === "object" &&
    value !== null &&
    authenticTerminalStates.has(value)
  );
}

function markTerminalState<T extends object>(
  value: T,
): T & { readonly [terminalApprovalStateBrand]: true } {
  Object.defineProperty(value, terminalApprovalStateBrand, {
    value: true,
    enumerable: false,
  });
  return value as T & { readonly [terminalApprovalStateBrand]: true };
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
