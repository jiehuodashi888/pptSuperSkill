import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv from "ajv";

import type { ApprovalRequest } from "../contracts/taxonomy.js";
import type { InstanceStore } from "../instances/store.js";
import { applyApproval, applyResourceShareApproval, type ApprovalState, type ResourceShareState } from "./state-machine.js";
import { assertResourceShareRequest, isResourceShareRequest, type ResourceShareRequest } from "./resource-sharing.js";

export type CanonicalApprovalRequest = ApprovalRequest | ResourceShareRequest;

/** Plain JSON decision contract shared by file clients and the optional UI.
 * Decisions do not grant in-memory approval provenance or mutate taxonomy.
 */
export interface ApprovalDecisionFile {
  companyId: string;
  request_id: string;
  request_hash: string;
  decision: { action: "approve" } | { action: "reject"; reason?: string };
}

export interface PendingApproval {
  companyId: string;
  request_hash: string;
  request: CanonicalApprovalRequest;
}

export class ApprovalFileError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const validateRequest = new Ajv.default({ strict: true }).compile(
  JSON.parse(readFileSync(new URL("../../schemas/approval.schema.json", import.meta.url), "utf8")),
);

function validId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) {
    throw new ApprovalFileError(400, "Invalid approval request id");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value)!;
}

function fingerprint(request: CanonicalApprovalRequest): string {
  return createHash("sha256").update(stableJson(request)).digest("hex");
}

/** Only call with application-owned fixed refs, never an HTTP path or query. */
export async function readReviewJson(store: InstanceStore, ref: string): Promise<unknown | null> {
  try {
    // Resolve each existing ancestor first: an absent leaf must not hide an
    // escaping symlink/junction in a parent directory.
    const parts = ref.split("/");
    for (let i = 1; i < parts.length; i++) store.resolve(parts.slice(0, i).join("/"));
    return JSON.parse(await readFile(store.resolve(ref), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ApprovalFileError(422, "Invalid or inaccessible instance review file");
  }
}

export async function readCanonicalApprovalRequest(store: InstanceStore, id: string): Promise<CanonicalApprovalRequest> {
  validId(id);
  const request = await readReviewJson(store, `approvals/requests/${id}.json`);
  if (request === null) throw new ApprovalFileError(404, "Approval request not found");
  if (isResourceShareRequest(request)) {
    try { assertResourceShareRequest(request, store.companyId); }
    catch { throw new ApprovalFileError(422, "Invalid canonical company resource share request"); }
    if (request.request_id !== id) throw new ApprovalFileError(422, "Resource share request identity mismatch");
    return request;
  }
  if (!validateRequest(request)) throw new ApprovalFileError(422, "Invalid canonical approval request");
  const typed = request as ApprovalRequest;
  if (typed.request_id !== id || typed.evidence.some(({ source_id }) => source_id.includes(":") && source_id.split(":")[0] !== store.companyId)) {
    throw new ApprovalFileError(422, "Approval request does not match its instance or identity");
  }
  return typed;
}

function validateDecision(value: unknown): asserts value is ApprovalDecisionFile {
  const v = value as ApprovalDecisionFile | null;
  if (!v || typeof v !== "object" || Array.isArray(v) ||
      Object.keys(v).sort().join(",") !== "companyId,decision,request_hash,request_id" ||
      typeof v.companyId !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(v.companyId) ||
      typeof v.request_hash !== "string" || !/^[a-f0-9]{64}$/.test(v.request_hash)) {
    throw new ApprovalFileError(400, "Invalid approval decision file");
  }
  validId(v.request_id);
  const d = v.decision;
  if (!d || typeof d !== "object" || Array.isArray(d) ||
      (d.action !== "approve" && d.action !== "reject") ||
      Object.keys(d).some((key) => key !== "action" && !(d.action === "reject" && key === "reason")) ||
      (d.action === "reject" && d.reason !== undefined && typeof d.reason !== "string")) {
    throw new ApprovalFileError(400, "Decision must approve or reject the existing request");
  }
}

export async function readApprovalDecision(store: InstanceStore, id: string, expectedRequest?: CanonicalApprovalRequest): Promise<ApprovalDecisionFile | null> {
  validId(id);
  const value = await readReviewJson(store, `approvals/decisions/${id}.json`);
  if (value === null) return null;
  validateDecision(value);
  const request = await readCanonicalApprovalRequest(store, id);
  if (value.companyId !== store.companyId || value.request_id !== id || value.request_hash !== fingerprint(request)
    || (expectedRequest !== undefined && (expectedRequest.request_id !== id || value.request_hash !== fingerprint(expectedRequest)))) {
    throw new ApprovalFileError(409, "Decision does not match the current instance request");
  }
  return value;
}

export async function listPendingApprovals(store: InstanceStore): Promise<PendingApproval[]> {
  let names: string[];
  try {
    store.resolve("approvals");
    names = await readdir(store.resolve("approvals/requests"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ApprovalFileError(422, "Invalid approval request directory");
  }
  const items: PendingApproval[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const request = await readCanonicalApprovalRequest(store, id);
    if (!await readApprovalDecision(store, id)) items.push({ companyId: store.companyId, request_hash: fingerprint(request), request });
  }
  return items;
}

export async function submitApprovalDecision(store: InstanceStore, value: unknown): Promise<ApprovalDecisionFile> {
  // File callers can retain their input object while disk I/O yields. Validate
  // and persist the same isolated snapshot, just as an HTTP JSON body does.
  try { value = structuredClone(value); }
  catch { throw new ApprovalFileError(400, "Approval decision must be plain data"); }
  validateDecision(value);
  if (value.companyId !== store.companyId) throw new ApprovalFileError(403, "Cross-instance approval rejected");
  const request = await readCanonicalApprovalRequest(store, value.request_id);
  if (value.request_hash !== fingerprint(request)) throw new ApprovalFileError(409, "Approval request changed; refresh before deciding");
  if (await readApprovalDecision(store, value.request_id)) throw new ApprovalFileError(409, "Approval request is already decided");
  const approvals = store.resolve("approvals");
  try { await mkdir(join(approvals, "decisions")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const directory = store.resolve("approvals/decisions");
  const temporary = join(directory, `.decision-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    // Publishing a complete file with an exclusive hard link prevents partial
    // reads and competing UI/file clients from overwriting an earlier decision.
    await link(temporary, join(directory, `${value.request_id}.json`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ApprovalFileError(409, "Approval request is already decided");
    throw error;
  } finally { await unlink(temporary).catch(() => undefined); }
  return value;
}

/** File/CLI consumers pass a genuine issued request; applyApproval retains its
 * existing provenance and single-use checks. Read the file through the store
 * first so company scope and the on-disk request are also checked.
 */
export function consumeApprovalDecision(store: InstanceStore, request: ApprovalRequest, value: ApprovalDecisionFile): ApprovalState;
export function consumeApprovalDecision(store: InstanceStore, request: ResourceShareRequest, value: ApprovalDecisionFile): ResourceShareState;
export function consumeApprovalDecision(store: InstanceStore, request: CanonicalApprovalRequest, value: ApprovalDecisionFile): ApprovalState | ResourceShareState {
  validateDecision(value);
  if (value.companyId !== store.companyId) throw new ApprovalFileError(403, "Cross-instance approval rejected");
  if (value.request_id !== request.request_id || value.request_hash !== fingerprint(request)) {
    throw new ApprovalFileError(409, "Decision does not match the issued request");
  }
  if (isResourceShareRequest(request)) {
    assertResourceShareRequest(request, store.companyId);
    return applyResourceShareApproval(request, value.decision);
  }
  return applyApproval(request, value.decision);
}
