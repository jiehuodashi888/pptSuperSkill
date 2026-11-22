import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { InstanceStore } from "../instances/store.js";
import { ApprovalFileError, listPendingApprovals, readReviewJson, submitApprovalDecision } from "../approvals/files.js";

export interface ReviewUiOptions {
  store: InstanceStore;
  host?: "127.0.0.1" | "::1" | "localhost" | string;
  port?: number;
}

export interface ReviewUiServer {
  readonly url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;

export async function startReviewUi(options: ReviewUiOptions): Promise<ReviewUiServer> {
  const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("Review UI requires a loopback host");
  if (options.store.companyId !== options.store.manifest.company_id) throw new Error("Review UI store company mismatch");
  const bindHost = host === "localhost" ? "127.0.0.1" : host;
  const staticFiles = new Map([
    ["/", { type: "text/html; charset=utf-8", body: await readFile(new URL("../../public/index.html", import.meta.url)) }],
    ["/app.js", { type: "text/javascript; charset=utf-8", body: await readFile(new URL("../../public/app.js", import.meta.url)) }],
  ]);
  let url = "";
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const status = error instanceof ApprovalFileError ? error.status : 500;
      json(res, status, { error: error instanceof ApprovalFileError ? error.message : "Local review operation failed" });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 40;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, bindHost, () => { server.off("error", reject); resolve(); });
  });
  url = `http://${bindHost === "::1" ? "[::1]" : bindHost}:${(server.address() as AddressInfo).port}`;
  let closing: Promise<void> | undefined;
  return {
    url,
    close() {
      closing ??= new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections(); });
      return closing;
    },
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const expectedHost = new URL(url).host;
    if (req.headers.host !== expectedHost || (req.headers.origin !== undefined && req.headers.origin !== url) || req.headers["sec-fetch-site"] === "cross-site") {
      throw new ApprovalFileError(403, "Only same-origin local review requests are allowed");
    }
    let path: string;
    try { path = decodeURIComponent(req.url ?? "/"); }
    catch { throw new ApprovalFileError(400, "Malformed request path"); }
    if (!path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.includes("?") || path.includes("#") || path.split("/").some((part) => part === ".." || part === ".")) {
      throw new ApprovalFileError(400, "Invalid request path");
    }
    const knownRead = staticFiles.has(path) || ["/api/approvals/pending", "/api/evidence", "/api/routing", "/api/audit"].includes(path);
    if (!knownRead && path !== "/api/approvals") throw new ApprovalFileError(404, "Review resource not found");
    const method = path === "/api/approvals" ? "POST" : "GET";
    if (req.method !== method) { res.setHeader("Allow", method); throw new ApprovalFileError(405, "Method not allowed"); }
    if (path === "/api/approvals") {
      if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") throw new ApprovalFileError(415, "Expected application/json");
      json(res, 201, await submitApprovalDecision(options.store, await readBody(req)));
    } else if (staticFiles.has(path)) {
      const file = staticFiles.get(path)!;
      res.writeHead(200, { "Content-Type": file.type }); res.end(file.body);
    } else if (path === "/api/approvals/pending" || path === "/api/evidence") {
      const items = await listPendingApprovals(options.store);
      json(res, 200, { items: path.endsWith("pending") ? items : items.map(({ companyId, request }) => ({ companyId, request_id: request.request_id, evidence: "evidence" in request ? request.evidence : [] })) });
    } else {
      const record = await readReviewJson(options.store, path === "/api/routing" ? "review/routing.json" : "review/audit.json");
      if (record && typeof record === "object" && "companyId" in record && record.companyId !== options.store.companyId) throw new ApprovalFileError(422, "Review record belongs to another company");
      json(res, 200, { companyId: options.store.companyId, record });
    }
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) throw new ApprovalFileError(413, "Approval body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApprovalFileError(413, "Approval body too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApprovalFileError(400, "Malformed JSON body"); }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
