import type { Evidence } from "./types.js";

export type TaxonomyDimension =
  | "business_type"
  | "visual_style"
  | "layout_pattern";

export interface TaxonomyEntry {
  id: string;
  name: string;
  tags: string[];
}

export interface ApprovedTaxonomy {
  dimension: TaxonomyDimension;
  entries: TaxonomyEntry[];
}

export interface ClassificationProposal {
  proposal_id: string;
  dimension: TaxonomyDimension;
  candidate: TaxonomyEntry;
  evidence: Evidence[];
  proposed_by: string;
}

export type TaxonomyChange =
  | {
      action: "publish";
      dimension: TaxonomyDimension;
      candidate: TaxonomyEntry;
    }
  | {
      action: "rename";
      dimension: TaxonomyDimension;
      entry_id: string;
      new_name: string;
    }
  | {
      action: "merge";
      dimension: TaxonomyDimension;
      source_ids: string[];
      result: TaxonomyEntry;
    }
  | {
      action: "split";
      dimension: TaxonomyDimension;
      source_id: string;
      entries: TaxonomyEntry[];
    }
  | {
      action: "deprecate";
      dimension: TaxonomyDimension;
      entry_id: string;
    };

export interface ApprovalRequest {
  request_id: string;
  status: "candidate" | "approved" | "rejected";
  change: TaxonomyChange;
  evidence: Evidence[];
  proposed_by: string;
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

  return {
    request_id: input.proposal_id,
    status: "candidate",
    change: {
      action: "publish",
      dimension: input.dimension,
      candidate: cloneEntry(input.candidate),
    },
    evidence: input.evidence.map((item) => ({ ...item })),
    proposed_by: input.proposed_by,
  };
}

function cloneEntry(entry: TaxonomyEntry): TaxonomyEntry {
  return { ...entry, tags: [...entry.tags] };
}
