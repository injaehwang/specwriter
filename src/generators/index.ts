import fs from "node:fs/promises";
import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { generateProjectSpec } from "./project-spec.js";
import { generateProjectRules } from "./project-rules.js";
import { generatePageStructure } from "./page-structure.js";
import { generateComponentSpecs } from "./component-specs.js";
import { generateAiIntegration } from "./ai-integration.js";

export async function generateOutput(
  spec: SpecOutput,
  config: AnalysisConfig
): Promise<void> {
  const outputDir = path.resolve(config.root, config.output);

  // Create output directories
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, "pages"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "components"), { recursive: true });

  // Write manifest
  await writeJson(path.join(outputDir, "manifest.json"), spec.manifest);

  // Generate all specs in parallel
  await Promise.all([
    generateProjectSpec(spec, outputDir, config),
    generateProjectRules(spec, outputDir, config),
    generatePageStructure(spec, outputDir, config),
    generateComponentSpecs(spec, outputDir, config),
    generateAiIntegration(spec, config),
  ]);
}

export async function writeJson(
  filePath: string,
  data: unknown
): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

export async function writeMarkdown(
  filePath: string,
  content: string
): Promise<void> {
  await fs.writeFile(filePath, content);
}
