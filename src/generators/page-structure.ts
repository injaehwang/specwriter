import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { PageInfo } from "../types/page.js";
import { renderWireframe } from "../wireframe/ascii-renderer.js";
import { writeJson, writeMarkdown } from "./index.js";

export async function generatePageStructure(
  spec: SpecOutput,
  outputDir: string,
  config: AnalysisConfig
): Promise<void> {
  const pagesDir = path.join(outputDir, "pages");

  // Index
  if (config.format === "json" || config.format === "both") {
    await writeJson(path.join(pagesDir, "_index.json"), {
      routes: spec.pageTree.routes.map((r) => ({
        path: r.path,
        name: r.name,
        file: r.filePath,
        isApi: r.isApiRoute,
        isDynamic: r.isDynamic,
        params: r.params,
      })),
      layouts: spec.pageTree.layouts,
      totalPages: spec.pageTree.pages.length,
    });
  }

  if (config.format === "md" || config.format === "both") {
    await writeMarkdown(
      path.join(pagesDir, "_index.md"),
      buildPageIndexMarkdown(spec)
    );
  }

  // Individual page specs
  for (const page of spec.pageTree.pages) {
    const safeName = sanitizeFileName(page.route.name);

    if (config.format === "json" || config.format === "both") {
      await writeJson(path.join(pagesDir, `${safeName}.json`), {
        route: page.route,
        components: page.components,
        dataFetching: page.dataFetching,
      });
    }

    if (config.format === "md" || config.format === "both") {
      await writeMarkdown(
        path.join(pagesDir, `${safeName}.md`),
        buildPageMarkdown(page, config)
      );
    }
  }
}

function buildPageIndexMarkdown(spec: SpecOutput): string {
  const lines: string[] = [];
  const { pageTree } = spec;

  lines.push("# Page Structure");
  lines.push("");

  // Route tree
  lines.push("## Route Map");
  lines.push("");
  lines.push("```");
  for (const route of pageTree.routes) {
    const prefix = route.isApiRoute ? "[API] " : "";
    const dynamic = route.isDynamic ? " (dynamic)" : "";
    lines.push(`${prefix}${route.path}${dynamic} → ${route.filePath}`);
  }
  lines.push("```");
  lines.push("");

  // Pages table
  const pageRoutes = pageTree.routes.filter((r) => !r.isApiRoute);
  if (pageRoutes.length > 0) {
    lines.push("## Pages");
    lines.push("");
    lines.push("| Name | Route | File | Components |");
    lines.push("|------|-------|------|------------|");
    for (const page of pageTree.pages) {
      const compCount = page.components.length;
      lines.push(
        `| ${page.route.name} | \`${page.route.path}\` | ${page.route.filePath} | ${compCount} |`
      );
    }
    lines.push("");
  }

  // Layouts
  if (pageTree.layouts.length > 0) {
    lines.push("## Layouts");
    lines.push("");
    for (const layout of pageTree.layouts) {
      lines.push(`- ${layout}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildPageMarkdown(page: PageInfo, config: AnalysisConfig): string {
  const lines: string[] = [];

  lines.push(`# ${page.route.name}`);
  lines.push("");
  lines.push(`**Route:** \`${page.route.path}\``);
  lines.push(`**File:** \`${page.route.filePath}\``);
  if (page.route.layout) {
    lines.push(`**Layout:** \`${page.route.layout}\``);
  }
  if (page.route.isDynamic) {
    lines.push(`**Parameters:** ${page.route.params.join(", ")}`);
  }
  lines.push("");

  // Wireframe
  if (config.wireframes && page.wireframe) {
    lines.push("## Wireframe");
    lines.push("");
    lines.push("```");
    lines.push(renderWireframe(page.wireframe));
    lines.push("```");
    lines.push("");
  }

  // Components
  if (page.components.length > 0) {
    lines.push("## Components");
    lines.push("");
    lines.push("| Component | Role | File |");
    lines.push("|-----------|------|------|");
    for (const comp of page.components) {
      lines.push(`| ${comp.name} | ${comp.role} | ${comp.filePath} |`);
    }
    lines.push("");
  }

  // Data Fetching
  if (page.dataFetching.length > 0) {
    lines.push("## Data Fetching");
    lines.push("");
    for (const df of page.dataFetching) {
      lines.push(`- **${df.type}**: ${df.method}${df.endpoint ? ` → ${df.endpoint}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
