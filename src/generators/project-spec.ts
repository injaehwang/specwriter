import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { writeJson, writeMarkdown } from "./index.js";

export async function generateProjectSpec(
  spec: SpecOutput,
  outputDir: string,
  config: AnalysisConfig
): Promise<void> {
  const { project } = spec;

  // JSON
  if (config.format === "json" || config.format === "both") {
    await writeJson(path.join(outputDir, "spec.json"), {
      name: project.name,
      version: project.version,
      description: project.description,
      framework: project.framework,
      techStack: project.techStack,
      structure: project.structure,
      routes: spec.pageTree.routes.map((r) => ({
        path: r.path,
        file: r.filePath,
        isApi: r.isApiRoute,
        isDynamic: r.isDynamic,
      })),
      componentCount: spec.components.length,
      pageCount: spec.pageTree.pages.length,
    });
  }

  // Markdown
  if (config.format === "md" || config.format === "both") {
    const md = buildSpecMarkdown(spec);
    await writeMarkdown(path.join(outputDir, "spec.md"), md);
  }
}

function buildSpecMarkdown(spec: SpecOutput): string {
  const { project, pageTree, components } = spec;
  const lines: string[] = [];

  lines.push(`# ${project.name}`);
  lines.push("");
  if (project.description) {
    lines.push(`> ${project.description}`);
    lines.push("");
  }

  // Tech Stack
  lines.push("## Tech Stack");
  lines.push("");
  lines.push(`| Category | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Framework | ${project.framework.name} ${project.framework.version} |`);
  lines.push(`| Language | ${project.techStack.language} |`);
  lines.push(`| Build Tool | ${project.techStack.buildTool} |`);
  lines.push(`| Package Manager | ${project.techStack.packageManager} |`);
  if (project.techStack.styling.length > 0) {
    lines.push(`| Styling | ${project.techStack.styling.join(", ")} |`);
  }
  if (project.techStack.stateManagement.length > 0) {
    lines.push(`| State Management | ${project.techStack.stateManagement.join(", ")} |`);
  }
  if (project.techStack.testing.length > 0) {
    lines.push(`| Testing | ${project.techStack.testing.join(", ")} |`);
  }
  if (project.techStack.linting.length > 0) {
    lines.push(`| Linting | ${project.techStack.linting.join(", ")} |`);
  }
  lines.push("");

  // Project Structure
  lines.push("## Project Structure");
  lines.push("");
  lines.push("```");
  if (project.structure.pagesDir) lines.push(`${project.structure.pagesDir}/    # Pages / Routes`);
  if (project.structure.componentsDir) lines.push(`${project.structure.componentsDir}/    # Components`);
  if (project.structure.apiDir) lines.push(`${project.structure.apiDir}/    # API Routes`);
  if (project.structure.publicDir) lines.push(`${project.structure.publicDir}/    # Static Assets`);
  lines.push("```");
  lines.push("");

  // Route Summary
  const pageRoutes = pageTree.routes.filter((r) => !r.isApiRoute);
  const apiRoutes = pageTree.routes.filter((r) => r.isApiRoute);

  if (pageRoutes.length > 0) {
    lines.push("## Pages");
    lines.push("");
    lines.push(`| Route | File | Dynamic |`);
    lines.push(`|-------|------|---------|`);
    for (const route of pageRoutes) {
      lines.push(`| \`${route.path}\` | ${route.filePath} | ${route.isDynamic ? "Yes" : "No"} |`);
    }
    lines.push("");
  }

  if (apiRoutes.length > 0) {
    lines.push("## API Routes");
    lines.push("");
    lines.push(`| Route | File |`);
    lines.push(`|-------|------|`);
    for (const route of apiRoutes) {
      lines.push(`| \`${route.path}\` | ${route.filePath} |`);
    }
    lines.push("");
  }

  // Component Summary
  lines.push("## Components Overview");
  lines.push("");
  lines.push(`Total: ${components.length} components`);
  lines.push("");

  const byType = new Map<string, number>();
  for (const comp of components) {
    byType.set(comp.type, (byType.get(comp.type) || 0) + 1);
  }
  lines.push(`| Type | Count |`);
  lines.push(`|------|-------|`);
  for (const [type, count] of byType) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push("");

  return lines.join("\n");
}
