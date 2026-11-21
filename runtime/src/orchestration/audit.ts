import type { Observation, Rule } from "../contracts/types.js";
import { OBSERVER_IDS } from "../observers/catalog.js";
import type {
  ClassificationProposal,
  ObservationRun,
  RuleProposal,
} from "./observe.js";

export const LOW_CONFIDENCE_RULE_THRESHOLD = 0.6;

export type AuditFindingType =
  | "conflict"
  | "absent-evidence"
  | "observer-failure"
  | "low-confidence-rule"
  | "candidate-classification"
  | "catalog-integrity";

export interface AuditFinding {
  readonly type: AuditFindingType;
  readonly message: string;
  readonly references: readonly string[];
}

export interface FinalAudit {
  readonly complete: boolean;
  readonly unresolved: readonly AuditFinding[];
}

export function auditRun(run: ObservationRun): FinalAudit {
  const observations = run.results.flatMap((result) => result.observations);
  const rules = run.results.flatMap((result) => result.rules);
  const classifications = run.results.flatMap((result) => result.classifications);
  const unresolved = [
    ...catalogIntegrityFindings(run),
    ...observationIdentityConflicts(observations),
    ...ruleIdentityConflicts(rules),
    ...observationConflicts(observations),
    ...ruleConflicts(rules),
    ...missingEvidenceFindings(run, rules, classifications),
    ...observerFailures(run),
    ...lowConfidenceRules(rules),
    ...candidateClassifications(classifications),
  ];
  return Object.freeze({
    complete: unresolved.length === 0,
    unresolved: Object.freeze(unresolved),
  });
}

function observationIdentityConflicts(
  observations: readonly Observation[],
): AuditFinding[] {
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    groups.set(observation.observation_id, [
      ...(groups.get(observation.observation_id) ?? []),
      observation,
    ]);
  }
  return [...groups].flatMap(([observationId, group]) =>
    group.length > 1 && new Set(group.map(stableJson)).size > 1
      ? [{
          type: "conflict" as const,
          message: `Conflicting payloads reuse observation_id ${observationId}`,
          references: [observationId],
        }]
      : []
  );
}

function ruleIdentityConflicts(proposals: readonly RuleProposal[]): AuditFinding[] {
  const groups = new Map<string, Rule[]>();
  for (const { rule } of proposals) {
    groups.set(rule.rule_id, [...(groups.get(rule.rule_id) ?? []), rule]);
  }
  return [...groups].flatMap(([ruleId, group]) =>
    group.length > 1 && new Set(group.map(stableJson)).size > 1
      ? [{
          type: "conflict" as const,
          message: `Conflicting payloads reuse rule_id ${ruleId}`,
          references: [ruleId],
        }]
      : []
  );
}

function catalogIntegrityFindings(run: ObservationRun): AuditFinding[] {
  const expected = new Set<string>(OBSERVER_IDS);
  const counts = new Map<string, number>();
  for (const { observerId } of run.results) {
    counts.set(observerId, (counts.get(observerId) ?? 0) + 1);
  }
  const findings: AuditFinding[] = [];
  for (const observerId of OBSERVER_IDS) {
    if (!counts.has(observerId)) {
      findings.push({
        type: "catalog-integrity",
        message: `Missing observer result: ${observerId}`,
        references: [observerId],
      });
    }
  }
  for (const [observerId, count] of counts) {
    if (count > 1) {
      findings.push({
        type: "catalog-integrity",
        message: `Duplicate observer result: ${observerId}`,
        references: [observerId],
      });
    }
  }
  for (const observerId of counts.keys()) {
    if (!expected.has(observerId)) {
      findings.push({
        type: "catalog-integrity",
        message: `Unexpected observer result: ${observerId}`,
        references: [observerId],
      });
    }
  }
  return findings;
}

function observationConflicts(observations: readonly Observation[]): AuditFinding[] {
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const evidenceKey = observation.evidence
      .map((item) => `${item.source_id}:${item.slide_number}:${item.element_ref}`)
      .sort()
      .join("|");
    const key = `${observation.category}\u0000${evidenceKey}`;
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  const findings: AuditFinding[] = [];
  for (const group of groups.values()) {
    if (group.length > 1 && new Set(group.map(({ fact }) => fact)).size > 1) {
      findings.push({
        type: "conflict",
        message: `Conflicting ${group[0]!.category} observations target the same evidence`,
        references: group.map(({ observation_id }) => observation_id),
      });
    }
  }
  return findings;
}

function ruleConflicts(proposals: readonly RuleProposal[]): AuditFinding[] {
  const groups = new Map<string, Rule[]>();
  for (const { rule } of proposals) {
    const key = `${rule.scope}\u0000${rule.statement}`;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  const findings: AuditFinding[] = [];
  for (const group of groups.values()) {
    const values = new Set(group.map(({ observed_value }) => stableJson(observed_value)));
    if (group.length > 1 && values.size > 1) {
      findings.push({
        type: "conflict",
        message: `Conflicting rule proposals for ${group[0]!.scope}: ${group[0]!.statement}`,
        references: group.map(({ rule_id }) => rule_id),
      });
    }
  }
  return findings;
}

function missingEvidenceFindings(
  run: ObservationRun,
  rules: readonly RuleProposal[],
  classifications: readonly ClassificationProposal[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const result of run.results) {
    if (!result.ok && result.errors.some((error) => /evidence/i.test(error))) {
      findings.push({
        type: "absent-evidence",
        message: `${result.observerId} produced a result without required evidence`,
        references: [result.observerId],
      });
    }
  }
  for (const { rule } of rules) {
    if (rule.evidence.length === 0) {
      findings.push({
        type: "absent-evidence",
        message: `Rule ${rule.rule_id} has no evidence`,
        references: [rule.rule_id],
      });
    }
  }
  for (const classification of classifications) {
    if (classification.evidence.length === 0) {
      findings.push({
        type: "absent-evidence",
        message: `Classification ${classification.classificationId} has no evidence`,
        references: [classification.classificationId],
      });
    }
  }
  return findings;
}

function observerFailures(run: ObservationRun): AuditFinding[] {
  return run.results.flatMap((result) => {
    if (result.ok || result.errors.some((error) => /evidence/i.test(error))) {
      return [];
    }
    return [{
      type: "observer-failure" as const,
      message: `${result.observerId} failed: ${result.errors.join("; ")}`,
      references: [result.observerId],
    }];
  });
}

function lowConfidenceRules(proposals: readonly RuleProposal[]): AuditFinding[] {
  return proposals.flatMap(({ rule, confidence }) =>
    confidence < LOW_CONFIDENCE_RULE_THRESHOLD
      ? [{
          type: "low-confidence-rule" as const,
          message: `Rule ${rule.rule_id} confidence ${confidence} is below ${LOW_CONFIDENCE_RULE_THRESHOLD}`,
          references: [rule.rule_id],
        }]
      : []
  );
}

function candidateClassifications(
  classifications: readonly ClassificationProposal[],
): AuditFinding[] {
  return classifications.flatMap((classification) =>
    classification.status === "candidate"
      ? [{
          type: "candidate-classification" as const,
          message: `Classification ${classification.classificationId} requires approval`,
          references: [classification.classificationId],
        }]
      : []
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
