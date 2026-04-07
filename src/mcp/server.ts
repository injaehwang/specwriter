import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { runAnalysis } from "../core/analyzer.js";
import { DEFAULT_CONFIG, type AnalysisConfig } from "../types/spec.js";

let projectRoot: string;
let specDir: string;

export async function startMcpServer(root: string): Promise<void> {
  projectRoot = path.resolve(root);
  specDir = path.join(projectRoot, ".specwriter");

  const server = new McpServer({
    name: "specwriter",
    version: "0.1.0",
  });

  // ─── Tools ───

  server.tool(
    "get_project_context",
    "Get complete project overview: tech stack, routes, components, conventions. Use this at the start of a conversation to understand the project.",
    {},
    async () => {
      const content = await readSpec("AI_CONTEXT.md");
      return { content: [{ type: "text" as const, text: content ?? "Specs not generated yet. Run update_specs first." }] };
    }
  );

  server.tool(
    "get_component",
    "Get detailed specification for a component: props, state, events, children, dependencies",
    { name: z.string().describe("Component name (e.g. Header, DataTable)") },
    async ({ name }) => {
      const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const md = await readSpec(`components/${safeName}.md`);
      const json = await readSpec(`components/${safeName}.json`);
      if (!md && !json) {
        // Try searching
        const index = await readSpec("components/_index.json");
        if (index) {
          const data = JSON.parse(index);
          const match = data.components?.find(
            (c: { name: string }) => c.name.toLowerCase() === name.toLowerCase()
          );
          if (match) {
            const matchSafe = match.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            const matchMd = await readSpec(`components/${matchSafe}.md`);
            if (matchMd) return { content: [{ type: "text" as const, text: matchMd }] };
          }
        }
        return { content: [{ type: "text" as const, text: `Component "${name}" not found. Run update_specs to refresh.` }] };
      }
      return { content: [{ type: "text" as const, text: md || json || "" }] };
    }
  );

  server.tool(
    "get_page",
    "Get page specification with wireframe, route info, and component list",
    { route: z.string().describe("Route path (e.g. /, /dashboard) or page name") },
    async ({ route }) => {
      // Try by route name first
      const safeName = route.replace(/^\//, "").replace(/\//g, "-") || "home";
      const safeClean = safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "home";
      const md = await readSpec(`pages/${safeClean}.md`);
      if (md) return { content: [{ type: "text" as const, text: md }] };

      // Try searching by route path in index
      const index = await readSpec("pages/_index.json");
      if (index) {
        const data = JSON.parse(index);
        const match = data.routes?.find(
          (r: { path: string; name: string }) =>
            r.path === route || r.name.toLowerCase() === route.toLowerCase()
        );
        if (match) {
          const matchSafe = match.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          const matchMd = await readSpec(`pages/${matchSafe}.md`);
          if (matchMd) return { content: [{ type: "text" as const, text: matchMd }] };
        }
      }

      return { content: [{ type: "text" as const, text: `Page "${route}" not found. Run update_specs to refresh.` }] };
    }
  );

  server.tool(
    "search_specs",
    "Search through all specifications for a keyword or pattern",
    { query: z.string().describe("Search term (e.g. 'form', 'auth', 'useState')") },
    async ({ query }) => {
      const results = await searchSpecs(query);
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No results found for "${query}".` }] };
      }
      const text = results
        .map((r) => `### ${r.file}\n${r.matches.join("\n")}`)
        .join("\n\n");
      return { content: [{ type: "text" as const, text: `## Search results for "${query}"\n\n${text}` }] };
    }
  );

  server.tool(
    "get_dependencies",
    "Get the dependency graph for a component: what it uses and what uses it",
    { name: z.string().describe("Component name") },
    async ({ name }) => {
      const index = await readSpec("components/_index.json");
      if (!index) {
        return { content: [{ type: "text" as const, text: "No component index found. Run update_specs first." }] };
      }
      const data = JSON.parse(index);
      const graph = data.graph;
      if (!graph) {
        return { content: [{ type: "text" as const, text: "No dependency graph available." }] };
      }

      const uses = graph.edges
        .filter((e: { from: string }) => e.from.toLowerCase() === name.toLowerCase())
        .map((e: { to: string; relation: string }) => `  → ${e.to} (${e.relation})`);

      const usedBy = graph.edges
        .filter((e: { to: string }) => e.to.toLowerCase() === name.toLowerCase())
        .map((e: { from: string; relation: string }) => `  ← ${e.from} (${e.relation})`);

      const lines = [`## Dependencies for ${name}`, ""];
      if (uses.length > 0) {
        lines.push("**Uses:**");
        lines.push(...uses);
        lines.push("");
      }
      if (usedBy.length > 0) {
        lines.push("**Used by:**");
        lines.push(...usedBy);
        lines.push("");
      }
      if (uses.length === 0 && usedBy.length === 0) {
        lines.push("No dependencies found for this component.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "get_rules",
    "Get project coding conventions and rules",
    {},
    async () => {
      const content = await readSpec("rules.md");
      return { content: [{ type: "text" as const, text: content || "No rules file found. Run update_specs first." }] };
    }
  );

  server.tool(
    "get_routes",
    "Get complete route map with page hierarchy",
    {},
    async () => {
      const content = await readSpec("pages/_index.md");
      return { content: [{ type: "text" as const, text: content || "No route index found. Run update_specs first." }] };
    }
  );

  server.tool(
    "update_specs",
    "Re-analyze the project and regenerate all specifications. Use after making code changes.",
    {},
    async () => {
      const config: AnalysisConfig = {
        ...DEFAULT_CONFIG,
        root: projectRoot,
      };

      // Load project config if exists
      try {
        const cfgContent = await fs.readFile(
          path.join(projectRoot, "specwriter.config.json"),
          "utf-8"
        );
        const cfg = JSON.parse(cfgContent);
        Object.assign(config, cfg, { root: projectRoot });
      } catch {
        // Use defaults
      }

      await runAnalysis(config, false);
      return { content: [{ type: "text" as const, text: "Specifications updated successfully." }] };
    }
  );

  server.tool(
    "list_components",
    "List all components with their types and file paths",
    {},
    async () => {
      const content = await readSpec("components/_index.md");
      return { content: [{ type: "text" as const, text: content || "No component index found." }] };
    }
  );

  // ─── Resources ───

  server.resource(
    "spec://project",
    "spec://project",
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: await readSpec("AI_CONTEXT.md") || "Not generated yet.",
        mimeType: "text/markdown",
      }],
    })
  );

  server.resource(
    "spec://rules",
    "spec://rules",
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: await readSpec("rules.md") || "Not generated yet.",
        mimeType: "text/markdown",
      }],
    })
  );

  server.resource(
    "spec://routes",
    "spec://routes",
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: await readSpec("pages/_index.md") || "Not generated yet.",
        mimeType: "text/markdown",
      }],
    })
  );

  // ─── Start ───

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── Helpers ───

async function readSpec(relativePath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(specDir, relativePath), "utf-8");
  } catch {
    return null;
  }
}

interface SearchResult {
  file: string;
  matches: string[];
}

async function searchSpecs(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  async function searchDir(dir: string, prefix: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await searchDir(fullPath, `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          if (content.toLowerCase().includes(lowerQuery)) {
            const lines = content.split("\n");
            const matches = lines
              .filter((line) => line.toLowerCase().includes(lowerQuery))
              .slice(0, 5)
              .map((line) => line.trim());
            if (matches.length > 0) {
              results.push({ file: `${prefix}${entry.name}`, matches });
            }
          }
        } catch {
          // Skip unreadable
        }
      }
    }
  }

  await searchDir(specDir, "");
  return results;
}
