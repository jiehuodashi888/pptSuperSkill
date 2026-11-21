import type { AuditFinding, AuditReport } from "./audit.js";

export type RepairChange = "mechanical" | "semantic-content" | "classification" | "data-meaning" | "route-selection" | "style-selection";

export interface RepairRecommendation {
  readonly action: string;
  readonly change: RepairChange;
  readonly target: { readonly slide_number: number; readonly element_ref: string };
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface RepairPolicy {
  readonly status: "approved" | "candidate";
  readonly whitelist: readonly {
    readonly action: string;
    readonly rule_ref: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  }[];
}

export interface RepairAction extends RepairRecommendation {
  readonly finding_id: string;
}

/** Review requests are pending proposals, never approval decisions or route handles. */
export interface RepairApprovalRequest {
  readonly status: "pending";
  readonly finding_id: string;
  readonly reason: string;
  readonly proposedFix: RepairRecommendation;
}

export interface RepairPlan {
  readonly actions: readonly RepairAction[];
  readonly approvalRequests: readonly RepairApprovalRequest[];
}

/** Despite the name this only plans repairs; no document or approval state is mutated. */
export function applySafeRepairs(report: AuditReport, policy: RepairPolicy): RepairPlan {
  const actions: RepairAction[] = [];
  const approvalRequests: RepairApprovalRequest[] = [];
  for (const finding of report.findings) {
    const fix = finding.recommended_fix;
    if (!fix) continue;
    const reason = approvalReason(finding, fix, policy);
    if (reason) {
      approvalRequests.push({ status: "pending", finding_id: finding.finding_id, reason, proposedFix: structuredClone(fix) });
    } else {
      // Project onto the fixed executor contract: never carry arbitrary payload fields.
      actions.push({ finding_id: finding.finding_id, action: fix.action, change: "mechanical", target: { slide_number: fix.target.slide_number, element_ref: fix.target.element_ref }, parameters: { ...fix.parameters } });
    }
  }
  return { actions, approvalRequests };
}

function approvalReason(finding: AuditFinding, fix: RepairRecommendation, policy: RepairPolicy): string | null {
  if (fix.change !== "mechanical" || finding.repairability !== "mechanical") return "Non-mechanical or approval-required changes require explicit approval";
  if (!validMechanicalParameters(fix.action, fix.parameters)) return "Operation or parameters are outside the supported mechanical repair set";
  if (!fix.target || !finding.evidence.some((evidence) => evidence.slide_number === fix.target.slide_number && evidence.element_ref === fix.target.element_ref)) return "Repair target is not supported by finding evidence";
  if (policy.status !== "approved" || !Array.isArray(policy.whitelist)) return "Repair policy is not approved";
  const allowed = policy.whitelist.some((entry) => entry && entry.action === fix.action && entry.rule_ref === finding.rule_ref && validMechanicalParameters(entry.action, entry.parameters) && sameParameters(entry.parameters, fix.parameters));
  return allowed ? null : "Repair is not an exact match for an approved whitelist entry";
}

/** Hard-coded schemas prevent a policy from authorizing arbitrary semantic operations.
 * Insets are inches (0–1); spacing is points (0–72). No text/data/style fields exist.
 */
function validMechanicalParameters(action: string, parameters: Readonly<Record<string, unknown>>): boolean {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return false;
  const fields = action === "set-text-insets" ? ["left", "right", "top", "bottom"] : action === "set-paragraph-spacing" ? ["before", "after"] : [];
  if (!fields.length || Object.keys(parameters).length !== fields.length || !fields.every((key) => Object.hasOwn(parameters, key))) return false;
  const max = action === "set-text-insets" ? 1 : 72;
  return fields.every((key) => typeof parameters[key] === "number" && Number.isFinite(parameters[key]) && (parameters[key] as number) >= 0 && (parameters[key] as number) <= max);
}

function sameParameters(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}
