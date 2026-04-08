import { Command } from "commander";
import path from "node:path";
import { DEFAULT_CONFIG, type AnalysisConfig } from "../../types/spec.js";
import { runAnalysis } from "../../core/analyzer.js";

export const analyzeCommand = new Command("update")
  .alias("analyze")
  .description("Re-analyze project and update specifications")
  .argument("[path]", "Path to the project root", ".")
  .option("-o, --output <dir>", "Output directory", DEFAULT_CONFIG.output)
  .option("--framework <name>", "Force framework detection", DEFAULT_CONFIG.framework)
  .option("--include <patterns...>", "Include glob patterns")
  .option("--exclude <patterns...>", "Exclude glob patterns")
  .option("--depth <n>", "Component nesting depth", String(DEFAULT_CONFIG.depth))
  .option("--no-wireframes", "Skip wireframe generation")
  .option("--format <type>", "Output format: json, md, both", DEFAULT_CONFIG.format)
  .option("--ai-target <mode>", "AI integration: auto (detect existing), none (skip)", "auto")
  .option("--verbose", "Verbose output", false)
  .option("--debug", "Debug mode — show all scan details", false)
  .action(async (targetPath: string, opts) => {
    const root = path.resolve(targetPath);

    console.log("");
    console.log("  ╔══════════════════════════════════════════╗");
    console.log("  ║  specwriter — Start spec writing...      ║");
    console.log("  ╚══════════════════════════════════════════╝");
    console.log("");
    console.log(`  Target: ${root}`);
    console.log("");

    const config: AnalysisConfig = {
      root,
      output: opts.output,
      framework: opts.framework,
      include: opts.include ?? DEFAULT_CONFIG.include,
      exclude: opts.exclude ?? DEFAULT_CONFIG.exclude,
      depth: parseInt(opts.depth, 10),
      wireframes: opts.wireframes,
      format: opts.format,
      aiTargets: opts.aiTarget ?? DEFAULT_CONFIG.aiTargets,
    };

    if (opts.debug) {
      (config as any)._debug = true;
    }

    await runAnalysis(config, opts.verbose);
  });
