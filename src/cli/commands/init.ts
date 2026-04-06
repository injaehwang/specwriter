import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { DEFAULT_CONFIG } from "../../types/spec.js";

export const initCommand = new Command("init")
  .description("Initialize specwriter configuration file")
  .argument("[path]", "Path to the project root", ".")
  .action(async (targetPath: string) => {
    const root = path.resolve(targetPath);
    const configPath = path.join(root, "specwriter.config.json");

    try {
      await fs.access(configPath);
      console.log("specwriter.config.json already exists. Skipping.");
      return;
    } catch {
      // File doesn't exist, proceed
    }

    const config = {
      output: DEFAULT_CONFIG.output,
      include: DEFAULT_CONFIG.include,
      exclude: DEFAULT_CONFIG.exclude,
      framework: "auto",
      depth: DEFAULT_CONFIG.depth,
      wireframes: true,
      format: DEFAULT_CONFIG.format,
      aiTargets: DEFAULT_CONFIG.aiTargets,
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log("Created specwriter.config.json");
  });
