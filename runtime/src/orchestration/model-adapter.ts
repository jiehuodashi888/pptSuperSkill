import type { AgentTask } from "../observers/catalog.js";

/** The only boundary through which observation orchestration invokes a model. */
export interface ModelAdapter {
  run(task: AgentTask): Promise<unknown>;
}
