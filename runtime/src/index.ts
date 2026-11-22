import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateInstance } from "./instances/validate.js";
import { fetchPublicFixtureCli } from "../../scripts/fetch-public-fixture.js";

export const frameworkVersion: string = "0.1.0";
export { runProtectedWorkflow, type ProtectedWorkflowInput, type ProtectedWorkflowReport } from "./workflow/protected.js";
export type { RuntimeDeploymentConfig } from "./resources/types.js";

const helpText = `enterprise-ppt-skill ${frameworkVersion}

Usage:
  npm run ppt-skill -- help
  npm run ppt-skill -- validate-instance <instance-directory>
  npm run ppt-skill -- fetch-public-fixture --url <http(s)-url> --confirm --instance <absolute-instance-directory> --name <basename> --purpose <text> --license-note <text>

Commands:
  help    Show this help message
  validate-instance    Validate resource catalogs when opted in; report legacy asset containment otherwise
  fetch-public-fixture    Explicitly acquire test-only bytes with provenance
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const command = process.argv[2] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(helpText);
  } else if (command === "validate-instance" || command === "fetch-public-fixture") {
    try {
      const args = process.argv.slice(3);
      if (command === "validate-instance" && args.length !== 1) throw new Error("validate-instance requires one instance directory");
      const result = command === "validate-instance" ? await validateInstance(args[0]!) : await fetchPublicFixtureCli(args);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stderr.write(`Unknown command: ${command}\n\n${helpText}`);
    process.exitCode = 1;
  }
}
