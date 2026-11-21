import type { Evidence } from "./types.js";

export type TaxonomyDimension =
  | "business_type"
  | "visual_style"
  | "layout_pattern";

export interface TaxonomyEntry {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
}

export interface ApprovedTaxonomy {
  readonly dimension: TaxonomyDimension;
  readonly entries: readonly TaxonomyEntry[];
}

export interface ClassificationProposal {
  readonly proposal_id: string;
  readonly dimension: TaxonomyDimension;
  readonly candidate: TaxonomyEntry;
  readonly evidence: readonly Evidence[];
  readonly proposed_by: string;
}

export type TaxonomyChange =
  | {
      readonly action: "publish";
      readonly dimension: TaxonomyDimension;
      readonly candidate: TaxonomyEntry;
    }
  | {
      readonly action: "rename";
      readonly dimension: TaxonomyDimension;
      readonly entry_id: string;
      readonly new_name: string;
    }
  | {
      readonly action: "merge";
      readonly dimension: TaxonomyDimension;
      readonly source_ids: readonly string[];
      readonly result: TaxonomyEntry;
    }
  | {
      readonly action: "split";
      readonly dimension: TaxonomyDimension;
      readonly source_id: string;
      readonly entries: readonly TaxonomyEntry[];
    }
  | {
      readonly action: "deprecate";
      readonly dimension: TaxonomyDimension;
      readonly entry_id: string;
    };

const approvalRequestBrand: unique symbol = Symbol("approvalRequest");
const issuedApprovalRequests = new WeakSet<object>();

export interface ApprovalRequest {
  readonly request_id: string;
  readonly status: "candidate";
  readonly change: TaxonomyChange;
  readonly evidence: readonly Evidence[];
  readonly proposed_by: string;
  readonly [approvalRequestBrand]: true;
}

export interface StyleProfile {
  profile_id: string;
  business_type: string;
  visual_style: string;
  layout_pattern: string;
  tags: string[];
}

export function proposeClassification(
  input: ClassificationProposal,
): ApprovalRequest {
  if (input.evidence.length === 0) {
    throw new Error("A classification proposal requires evidence");
  }

  const request: ApprovalRequest = {
    request_id: input.proposal_id,
    status: "candidate",
    change: Object.freeze({
      action: "publish",
      dimension: input.dimension,
      candidate: cloneEntry(input.candidate),
    }),
    evidence: Object.freeze(
      input.evidence.map((item) => Object.freeze({ ...item })),
    ),
    proposed_by: input.proposed_by,
    [approvalRequestBrand]: true,
  };

  Object.freeze(request);
  issuedApprovalRequests.add(request);
  return request;
}

function cloneEntry(entry: TaxonomyEntry): TaxonomyEntry {
  return Object.freeze({ ...entry, tags: Object.freeze([...entry.tags]) });
}

export function isIssuedApprovalRequest(
  value: object,
): value is ApprovalRequest {
  return issuedApprovalRequests.has(value);
}
