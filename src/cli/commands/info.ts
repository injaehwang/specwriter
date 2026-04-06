import { Command } from "commander";
import path from "node:path";
import { detectFramework } from "../../detect/index.js";

export const infoCommand = new Command("info")
  .description("Show detected framework and project information")
  .argument("[path]", "Path to the project root", ".")
  .action(async (targetPath: string) => {
    const root = path.resolve(targetPath);
    const result = await detectFramework(root);

    console.log("\n  Project Info");
    console.log("  ──────────────────────");
    console.log(`  Root:       ${root}`);
    console.log(`  Framework:  ${result.frameworkId} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
    console.log(`  Evidence:`);
    for (const e of result.evidence) {
      console.log(`    - ${e}`);
    }
    console.log();
  });
