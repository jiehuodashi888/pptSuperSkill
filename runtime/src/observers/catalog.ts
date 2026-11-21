import type { CapabilityManifest } from "../contracts/types.js";
import { validateContract } from "../contracts/validate.js";

export const OBSERVER_IDS = [
  "style-classifier",
  "typography",
  "visual-style",
  "layout",
  "master-template",
  "table",
  "chart",
  "visual-asset",
  "content",
] as const;

export type ObserverId = (typeof OBSERVER_IDS)[number];
export type ObservationLevel = "slide" | "deck" | "corpus";

export interface ObservationInput {
  readonly companyId: string;
  readonly level: ObservationLevel;
  readonly sourceIds: readonly string[];
  readonly capabilities?: CapabilityManifest;
  readonly structuralFacts?: unknown;
  readonly renderedAssets?: readonly string[];
}

export interface AgentTask {
  readonly observerId: ObserverId;
  readonly promptReference: string;
  readonly input: ObservationInput;
}

const PROMPT_ROOT =
  ".cursor/skills/enterprise-ppt-multistyle/references/observers";

export function createObservationTask(
  observerId: ObserverId,
  input: ObservationInput,
): AgentTask {
  validateTaskInput(observerId, input);

  return {
    observerId,
    promptReference: `${PROMPT_ROOT}/${observerId}.md`,
    input,
  };
}

function validateTaskInput(
  observerId: ObserverId,
  input: ObservationInput,
): void {
  if (!(OBSERVER_IDS as readonly string[]).includes(observerId)) {
    throw new Error(`Unknown observer: ${observerId}`);
  }
  if (typeof input.companyId !== "string" || input.companyId.trim() === "") {
    throw new Error("Observation input requires a non-empty companyId");
  }
  if (
    !Array.isArray(input.sourceIds) ||
    input.sourceIds.length === 0 ||
    input.sourceIds.some(
      (sourceId) => typeof sourceId !== "string" || sourceId.trim() === "",
    )
  ) {
    throw new Error("Observation input requires non-empty sourceIds");
  }
  if (!["slide", "deck", "corpus"].includes(input.level)) {
    throw new Error(`Unsupported observation level: ${input.level}`);
  }
  if (
    input.capabilities !== undefined &&
    !validateContract("capability-manifest", input.capabilities).ok
  ) {
    throw new Error("Observation input contains an invalid capability manifest");
  }
}
