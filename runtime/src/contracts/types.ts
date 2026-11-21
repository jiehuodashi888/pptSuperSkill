export interface CapabilityManifest {
  pptxRead: boolean;
  pptxWrite: boolean;
  renderSlides: boolean;
  imageAnalysis: boolean;
  parallelAgents: boolean;
}

export type CapabilityName = keyof CapabilityManifest;

export type CapabilityProbes = CapabilityManifest;

export interface Evidence {
  source_id: string;
  slide_number: number;
  element_ref: string;
  source_type: string;
  locator: string;
}

export interface Observation {
  observation_id: string;
  category: string;
  fact: string;
  evidence: Evidence[];
  confidence: number;
  agent_id: string;
  coverage: number;
  missing_capabilities: CapabilityName[];
  unknown_fields: string[];
}

export type RulePriority = "MUST" | "SHOULD" | "MAY" | "CONDITIONAL" | "UNKNOWN";

export type RuleStatus = "candidate" | "approved" | "deprecated" | "rejected";

export interface Rule {
  rule_id: string;
  scope: string;
  statement: string;
  observed_value: unknown;
  priority: RulePriority;
  frequency: number;
  evidence: Evidence[];
  exceptions: unknown[];
  status: RuleStatus;
}

export type ContractName = "capability-manifest" | "observation" | "rule";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
