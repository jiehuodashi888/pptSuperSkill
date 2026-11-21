import type { ApprovalRequest, TaxonomyEntry } from "../contracts/taxonomy.js";

export type ApprovalState = ApprovalRequest;

export type ApprovalDecision =
  | { action: "approve" }
  | { action: "reject"; reason?: string }
  | { action: "publish" }
  | { action: "rename"; newName: string }
  | { action: "merge"; target_ids: string[] }
  | { action: "split"; entries: TaxonomyEntry[] }
  | { action: "deprecate" };

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

  return {
    ...state,
    status: decision.action === "approve" ? "approved" : "rejected",
    change: cloneChange(state.change),
    evidence: state.evidence.map((item) => ({ ...item })),
  };
}

function cloneChange(change: ApprovalRequest["change"]): ApprovalRequest["change"] {
  switch (change.action) {
    case "publish":
      return { ...change, candidate: cloneEntry(change.candidate) };
    case "merge":
      return {
        ...change,
        source_ids: [...change.source_ids],
        result: cloneEntry(change.result),
      };
    case "split":
      return { ...change, entries: change.entries.map(cloneEntry) };
    default:
      return { ...change };
  }
}

function cloneEntry(entry: TaxonomyEntry): TaxonomyEntry {
  return { ...entry, tags: [...entry.tags] };
}
