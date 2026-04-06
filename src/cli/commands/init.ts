import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { DEFAULT_CONFIG, type AnalysisConfig } from "../../types/spec.js";
import { runAnalysis } from "../../core/analyzer.js";

export const initCommand = new Command("init")
  .description("Initialize specwriter and analyze the project")
  .argument("[path]", "Path to the project root", ".")
  .option("--config-only", "Only create config file without analysis", false)
  .option("--no-wireframes", "Skip wireframe generation")
  .option("--format <type>", "Output format: json, md, both", DEFAULT_CONFIG.format)
  .option("--ai-target <targets...>", "AI targets: claude, cursor", DEFAULT_CONFIG.aiTargets)
  .option("--debug", "Debug mode — show all scan details", false)
  .action(async (targetPath: string, opts) => {
    const root = path.resolve(targetPath);
    const configPath = path.join(root, "specwriter.config.json");

    console.log("");
    console.log("  ╔══════════════════════════════════════════╗");
    console.log("  ║  specwriter — Start spec writing...      ║");
    console.log("  ╚══════════════════════════════════════════╝");
    console.log("");
    console.log(`  Target: ${root}`);
    console.log("");

    // Create config file if it doesn't exist
    let existingConfig = false;
    try {
      await fs.access(configPath);
      existingConfig = true;
    } catch {
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
      console.log("  Created specwriter.config.json\n");
    }

    if (opts.configOnly) return;

    // Run analysis automatically
    const analysisConfig: AnalysisConfig = {
      root,
      output: DEFAULT_CONFIG.output,
      framework: "auto",
      include: DEFAULT_CONFIG.include,
      exclude: DEFAULT_CONFIG.exclude,
      depth: DEFAULT_CONFIG.depth,
      wireframes: opts.wireframes,
      format: opts.format,
      aiTargets: opts.aiTarget ?? DEFAULT_CONFIG.aiTargets,
    };

    // If existing config, load it
    if (existingConfig) {
      try {
        const cfgContent = await fs.readFile(configPath, "utf-8");
        const cfg = JSON.parse(cfgContent);
        if (cfg.output) analysisConfig.output = cfg.output;
        if (cfg.include) analysisConfig.include = cfg.include;
        if (cfg.exclude) analysisConfig.exclude = cfg.exclude;
        if (cfg.framework) analysisConfig.framework = cfg.framework;
        if (cfg.depth) analysisConfig.depth = cfg.depth;
        if (cfg.wireframes !== undefined) analysisConfig.wireframes = cfg.wireframes;
        if (cfg.format) analysisConfig.format = cfg.format;
        if (cfg.aiTargets) analysisConfig.aiTargets = cfg.aiTargets;
      } catch {
        // Use defaults if config is invalid
      }
    }

    if (opts.debug) {
      (analysisConfig as any)._debug = true;
    }

    await runAnalysis(analysisConfig, true);
  });
