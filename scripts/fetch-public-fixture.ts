import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openInstance } from "../runtime/src/instances/store.js";

export interface PublicFixtureOptions {
  readonly instanceDirectory: string;
  readonly url: string;
  readonly confirm: boolean;
  readonly name: string;
  readonly purpose: string;
  readonly licenseUseNote: string;
}

export interface PublicFixtureManifest {
  readonly url: string;
  readonly retrieved_at: string;
  readonly sha256: string;
  readonly purpose: string;
  readonly license_use_note: string;
  readonly fixture_file: string;
  readonly classification: "test-only";
}

type Transport = (url: string, init?: RequestInit) => Promise<Response>;
const MAX_BYTES = 32 * 1024 * 1024;

/** Network is invoked only after consent and local scope validation. Tests inject
 * an in-memory transport; importing this module never initiates acquisition.
 */
export async function fetchPublicFixture(options: PublicFixtureOptions, transport: Transport = fetch) {
  const { instanceDirectory, url, confirm, name, purpose, licenseUseNote } = options;
  validateConsent(url, confirm);
  if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) throw new Error("Fixture name must be a safe local basename");
  if (typeof purpose !== "string" || !purpose.trim() || typeof licenseUseNote !== "string" || !licenseUseNote.trim()) throw new Error("Purpose and license/use note are required");
  if (typeof instanceDirectory !== "string" || !isAbsolute(instanceDirectory) || /^[/\\]{2}/.test(instanceDirectory)) throw new Error("Instance directory must be an explicit absolute local path");
  const instancePath = resolve(instanceDirectory);
  await rejectLinks(instancePath);
  const store = await openInstance(dirname(instancePath), basename(instancePath));
  const directory = join(store.root, "tests", "public-fixtures");
  await rejectLinks(directory);
  await mkdir(directory, { recursive: true });
  await rejectLinks(directory);
  const canonicalDirectory = await realpath(directory);
  if (canonicalDirectory !== directory) throw new Error("Fixture directory changed canonical scope");
  const fixturePath = join(directory, `${name}.bin`);
  const manifestPath = join(directory, `${name}.manifest.json`);
  for (const path of [fixturePath, manifestPath]) {
    try { await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    throw new Error("Fixture or manifest already exists");
  }
  const response = await transport(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || response.redirected) throw new Error(`HTTP acquisition failed or redirected: ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Fixture exceeds 32 MiB limit");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error("Fixture HTTP response has no body");
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new Error("Fixture exceeds 32 MiB limit");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (!size) throw new Error("Fixture HTTP response is empty");
  const bytes = Buffer.concat(chunks);
  const manifest: PublicFixtureManifest = { url, retrieved_at: new Date().toISOString(), sha256: createHash("sha256").update(bytes).digest("hex"), purpose, license_use_note: licenseUseNote, fixture_file: `${name}.bin`, classification: "test-only" };
  await rejectLinks(directory);
  await writeFile(fixturePath, bytes, { flag: "wx" });
  try { await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" }); }
  catch (error) { await unlink(fixturePath); throw error; }
  return { fixturePath, manifestPath, manifest };
}

function validateConsent(url: string, confirm: boolean): void {
  if (typeof url !== "string" || !url.trim()) throw new Error("An explicitly supplied public URL is required");
  if (confirm !== true) throw new Error("Explicit --confirm is required to acquire a public fixture");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Fixture URL must be valid HTTP(S)"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || url.includes("#") || url !== url.trim()) throw new Error("Fixture URL must be HTTP(S), without credentials or fragments");
}

async function rejectLinks(directory: string): Promise<void> {
  let current = resolve(directory);
  while (true) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error("Fixture output cannot traverse a symbolic link or junction");
      if (!entry.isDirectory()) throw new Error("Fixture output ancestor is not a directory");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function fetchPublicFixtureCli(args: readonly string[]) {
  const values = new Map<string, string>();
  let confirm = false;
  const allowed = ["--url", "--instance", "--name", "--purpose", "--license-note"];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--confirm" && !confirm) { confirm = true; continue; }
    if (!allowed.includes(flag) || values.has(flag) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`Invalid or duplicate fixture argument: ${flag}`);
    values.set(flag, args[++i]!);
  }
  validateConsent(values.get("--url") ?? "", confirm);
  return fetchPublicFixture({ url: values.get("--url")!, confirm, instanceDirectory: values.get("--instance") ?? "", name: values.get("--name") ?? "", purpose: values.get("--purpose") ?? "", licenseUseNote: values.get("--license-note") ?? "" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  fetchPublicFixtureCli(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
