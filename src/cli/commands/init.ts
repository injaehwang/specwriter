import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { DEFAULT_CONFIG, type AnalysisConfig } from "../../types/spec.js";
import { runAnalysis } from "../../core/analyzer.js";
import { figmaUrlToWireframe } from "../../features/figma.js";
import { wireframeToMarkdown, extractComponentsFromWireframe } from "../../features/wireframe.js";

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
        figma: {
          url: "",
        },
      };
      await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log("  Created specwriter.config.json\n");
    }

    if (opts.configOnly) return;

    // Load config
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

    let figmaConfig: { url?: string } = {};

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
        if (cfg.figma) figmaConfig = cfg.figma;
      } catch {
        // Use defaults
      }
    }

    if (opts.debug) {
      (analysisConfig as any)._debug = true;
    }

    // Run code analysis
    await runAnalysis(analysisConfig, true);

    // Auto-import Figma if configured
    if (figmaConfig.url) {
      await importFigmaDesigns(root, analysisConfig.output, figmaConfig);
    }
  });

// ─── Figma auto-import ───

async function importFigmaDesigns(
  root: string,
  output: string,
  figmaConfig: { url?: string },
) {
  const token = await findFigmaToken(root);
  if (!token) {
    console.log("  Figma: no FIGMA_TOKEN in .env — skipping\n");
    return;
  }

  if (!figmaConfig.url) return;

  const specDir = path.join(root, output);

  console.log("  Figma: importing...");

  try {
    // Just URL — auto-fetches all top-level frames
    const wireframe = await figmaUrlToWireframe(figmaConfig.url, token);
    const md = wireframeToMarkdown(wireframe);
    const extracted = extractComponentsFromWireframe(wireframe);

    const wireframeDir = path.join(specDir, "wireframes");
    await fs.mkdir(wireframeDir, { recursive: true });
    const fileName = wireframe.pageName.toLowerCase().replace(/\s+/g, "-");
    await fs.writeFile(path.join(wireframeDir, `${fileName}.md`), md);

    console.log(`  Figma: ✓ ${wireframe.pageName} — ${extracted.length} components`);
  } catch (err) {
    console.log(`  Figma: ✗ ${(err as Error).message}`);
  }

  console.log("");
}

async function findFigmaToken(root: string): Promise<string | null> {
  // 1. System env
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;

  // 2. .env files
  const envFiles = [".env", ".env.local", ".env.development"];
  for (const envFile of envFiles) {
    try {
      const content = await fs.readFile(path.join(root, envFile), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("FIGMA_TOKEN=") || trimmed.startsWith("FIGMA_ACCESS_TOKEN=")) {
          const value = trimmed.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
          if (value && !value.startsWith("<") && value !== "xxx") return value;
        }
      }
    } catch {
      // File doesn't exist
    }
  }

  return null;
}
