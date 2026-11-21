import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { validateContract } from "../contracts/validate.js";

export interface InstanceManifest {
  company_id: string;
  core_version: string;
  assets: string[];
  policy?: Record<string, unknown>;
}

export async function loadInstanceManifest(
  companyRoot: string,
): Promise<InstanceManifest> {
  const manifestPath = join(companyRoot, "instance.yaml");
  let value: unknown;

  try {
    // JSON is a YAML subset. Keeping manifests in this safe subset avoids executable
    // YAML features and adds no parser-specific behavior at the trust boundary.
    value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot load instance manifest at ${manifestPath}`, {
      cause: error,
    });
  }

  const validation = validateContract("instance", value);
  if (!validation.ok) {
    throw new Error(`Invalid instance manifest: ${validation.errors.join("; ")}`);
  }

  return value as InstanceManifest;
}
