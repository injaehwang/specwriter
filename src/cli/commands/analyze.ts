import { Command } from "commander";
import path from "node:path";
import { DEFAULT_CONFIG, type AnalysisConfig } from "../../types/spec.js";
import { runAnalysis } from "../../core/analyzer.js";

export const analyzeCommand = new Command("analyze")
  .description("Analyze a project and generate specifications")
  .argument("[path]", "Path to the project root", ".")
  .option("-o, --output <dir>", "Output directory", DEFAULT_CONFIG.output)
  .option("--framework <name>", "Force framework detection", DEFAULT_CONFIG.framework)
  .option("--include <patterns...>", "Include glob patterns")
  .option("--exclude <patterns...>", "Exclude glob patterns")
  .option("--depth <n>", "Component nesting depth", String(DEFAULT_CONFIG.depth))
  .option("--no-wireframes", "Skip wireframe generation")
  .option("--format <type>", "Output format: json, md, both", DEFAULT_CONFIG.format)
  .option("--ai-target <targets...>", "AI targets: claude, cursor", DEFAULT_CONFIG.aiTargets)
  .option("--verbose", "Verbose output", false)
  .action(async (targetPath: string, opts) => {
    const root = path.resolve(targetPath);

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

    await runAnalysis(config, opts.verbose);
  });
