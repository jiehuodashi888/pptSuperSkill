import { readFileSync } from "node:fs";

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import type { ContractName, ValidationResult } from "./types.js";

function loadSchema(fileName: string): object {
  return JSON.parse(
    readFileSync(new URL(`../../schemas/${fileName}`, import.meta.url), "utf8"),
  ) as object;
}

const ajv = new Ajv.default({ allErrors: true, strict: true });

const validators: Record<ContractName, ValidateFunction> = {
  "capability-manifest": ajv.compile(loadSchema("capability-manifest.schema.json")),
  instance: ajv.compile(loadSchema("instance.schema.json")),
  observation: ajv.compile(loadSchema("observation.schema.json")),
  rule: ajv.compile(loadSchema("rule.schema.json")),
  "resource-catalog": ajv.compile(loadSchema("resource-catalog.schema.json")),
  "style-manifest": ajv.compile(loadSchema("style-manifest.schema.json")),
};

function formatError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

export function validateContract(name: ContractName, value: unknown): ValidationResult {
  const validator = validators[name];
  const ok = validator(value);

  if (ok && name === "resource-catalog") {
    const records = (value as { resources: Array<Record<string, unknown>> }).resources;
    const identities = new Set<string>();
    for (const record of records) {
      const identity = [
        record.resourceId,
        record.scope,
        record.companyId ?? "",
        record.styleId ?? "",
        record.version,
        record.sha256,
      ].join("\\u0000");
      if (identities.has(identity)) {
        return { ok: false, errors: ["/resources duplicate full resource identity"] };
      }
      identities.add(identity);
    }
  }

  return {
    ok,
    errors: ok ? [] : (validator.errors ?? []).map(formatError),
  };
}
