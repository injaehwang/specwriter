import fs from "node:fs/promises";
import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { generateComponentSpecs } from "./component-specs.js";
import { generateAiIntegration } from "./ai-integration.js";

export async function generateOutput(
  spec: SpecOutput,
  config: AnalysisConfig
): Promise<void> {
  const outputDir = path.resolve(config.root, config.output);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, "pages"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "layouts"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "components"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "features"), { recursive: true });

  // Single JSON index for MCP queries
  await writeJson(path.join(outputDir, "index.json"), {
    manifest: spec.manifest,
    framework: spec.project.framework,
    routes: spec.pageTree.routes.map((r) => ({
      path: r.path, file: r.filePath, isApi: r.isApiRoute, isDynamic: r.isDynamic,
    })),
    components: spec.components.map((c) => ({
      name: c.name, file: c.filePath, type: c.type, propsCount: c.props.length,
    })),
    graph: spec.componentGraph,
  });

  // Component specs (MD only, for MCP get_component queries)
  await generateComponentSpecs(spec, outputDir, { ...config, format: "md" });

  // AI_CONTEXT.md + AI config injection
  await generateAiIntegration(spec, config);
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

export async function writeMarkdown(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content);
}
