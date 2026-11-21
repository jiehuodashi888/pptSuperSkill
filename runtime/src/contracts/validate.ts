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
  observation: ajv.compile(loadSchema("observation.schema.json")),
  rule: ajv.compile(loadSchema("rule.schema.json")),
};

function formatError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

export function validateContract(name: ContractName, value: unknown): ValidationResult {
  const validator = validators[name];
  const ok = validator(value);

  return {
    ok,
    errors: ok ? [] : (validator.errors ?? []).map(formatError),
  };
}
