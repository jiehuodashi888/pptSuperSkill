import { fileURLToPath } from "node:url";

export const frameworkVersion: string = "0.1.0";

const helpText = `enterprise-ppt-skill ${frameworkVersion}

Usage:
  npm run ppt-skill -- help

Commands:
  help    Show this help message
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(helpText);
  } else {
    process.stderr.write(`Unknown command: ${command}\n\n${helpText}`);
    process.exitCode = 1;
  }
}
