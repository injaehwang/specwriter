import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { runAnalysis } from "../core/analyzer.js";
import { DEFAULT_CONFIG, type AnalysisConfig } from "../types/spec.js";
import {
  createFeature, getFeature, listFeatures, updateFeature,
  addPageToFeature, addComponentToFeature, addApiToFeature,
  type FeaturePage, type FeatureComponent, type FeatureApi,
} from "../features/manager.js";
import {
  buildWireframe, extractComponentsFromWireframe, wireframeToMarkdown,
  type WireframeSection,
} from "../features/wireframe.js";

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

  // ─── Feature Management Tools ───

  server.tool(
    "create_feature",
    "Create a new feature specification. Use this when the user wants to build a new feature. Automatically suggests reusable components from the existing codebase.",
    {
      name: z.string().describe("Feature name (e.g. 'Login', 'User Dashboard', 'Payment Flow')"),
      description: z.string().describe("What this feature does in 1-2 sentences"),
    },
    async ({ name, description }) => {
      const feature = await createFeature(specDir, name, description, null);
      const md = await readSpec(`features/${feature.slug}.md`);
      return { content: [{ type: "text" as const, text: `Feature "${name}" created.\n\n${md || ""}` }] };
    }
  );

  server.tool(
    "get_feature",
    "Get a feature specification by name. Read this before implementing a feature.",
    { name: z.string().describe("Feature name or slug") },
    async ({ name }) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const md = await readSpec(`features/${slug}.md`);
      if (md) return { content: [{ type: "text" as const, text: md }] };
      return { content: [{ type: "text" as const, text: `Feature "${name}" not found. Use create_feature to create it.` }] };
    }
  );

  server.tool(
    "list_features",
    "List all feature specifications and their status",
    {},
    async () => {
      const features = await listFeatures(specDir);
      if (features.length === 0) {
        return { content: [{ type: "text" as const, text: "No features defined yet. Use create_feature to create one." }] };
      }
      const lines = features.map((f) =>
        `- **${f.name}** [${f.status}] — ${f.description} (${f.pages.length} pages, ${f.components.length} components, ${f.api.length} endpoints)`
      );
      return { content: [{ type: "text" as const, text: `## Features\n\n${lines.join("\n")}` }] };
    }
  );

  server.tool(
    "update_feature",
    "Update a feature's status or notes. Use after implementing or when planning changes.",
    {
      name: z.string().describe("Feature name or slug"),
      status: z.enum(["draft", "in-progress", "done"]).optional().describe("New status"),
      notes: z.string().optional().describe("Implementation notes or decisions"),
    },
    async ({ name, status, notes }) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const updates: Record<string, unknown> = {};
      if (status) updates.status = status;
      if (notes) updates.notes = notes;

      const feature = await updateFeature(specDir, slug, updates);
      if (!feature) return { content: [{ type: "text" as const, text: `Feature "${name}" not found.` }] };

      return { content: [{ type: "text" as const, text: `Feature "${feature.name}" updated to [${feature.status}].` }] };
    }
  );

  server.tool(
    "add_feature_page",
    "Add a page to a feature specification",
    {
      feature: z.string().describe("Feature name or slug"),
      route: z.string().describe("Page route (e.g. /login, /dashboard/settings)"),
      description: z.string().describe("What this page does"),
      components: z.array(z.string()).optional().describe("Components needed on this page"),
    },
    async ({ feature, route, description, components }) => {
      const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const page: FeaturePage = { route, description, components: components || [] };
      const updated = await addPageToFeature(specDir, slug, page);
      if (!updated) return { content: [{ type: "text" as const, text: `Feature "${feature}" not found.` }] };
      return { content: [{ type: "text" as const, text: `Added page ${route} to feature "${updated.name}".` }] };
    }
  );

  server.tool(
    "add_feature_component",
    "Add a component to a feature specification",
    {
      feature: z.string().describe("Feature name or slug"),
      name: z.string().describe("Component name (e.g. LoginForm, UserCard)"),
      description: z.string().describe("What this component does"),
      props: z.array(z.string()).optional().describe("Props this component needs"),
      isNew: z.boolean().optional().describe("Whether this is a new component (true) or existing (false)"),
    },
    async ({ feature, name, description, props, isNew }) => {
      const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const comp: FeatureComponent = { name, description, props: props || [], isNew: isNew ?? true };
      const updated = await addComponentToFeature(specDir, slug, comp);
      if (!updated) return { content: [{ type: "text" as const, text: `Feature "${feature}" not found.` }] };
      return { content: [{ type: "text" as const, text: `Added component ${name} to feature "${updated.name}".` }] };
    }
  );

  server.tool(
    "add_feature_api",
    "Add an API endpoint to a feature specification",
    {
      feature: z.string().describe("Feature name or slug"),
      method: z.string().describe("HTTP method (GET, POST, PUT, DELETE)"),
      path: z.string().describe("API path (e.g. /api/auth/login)"),
      description: z.string().describe("What this endpoint does"),
    },
    async ({ feature, method, path: apiPath, description }) => {
      const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const api: FeatureApi = { method: method.toUpperCase(), path: apiPath, description };
      const updated = await addApiToFeature(specDir, slug, api);
      if (!updated) return { content: [{ type: "text" as const, text: `Feature "${feature}" not found.` }] };
      return { content: [{ type: "text" as const, text: `Added ${method.toUpperCase()} ${apiPath} to feature "${updated.name}".` }] };
    }
  );

  // ─── Wireframe Tools ───

  server.tool(
    "design_wireframe",
    "Design an ASCII wireframe for a page. Define the layout sections (header, sidebar, main content areas, footer) with their components. The wireframe is saved to the feature spec and components are auto-extracted.",
    {
      feature: z.string().describe("Feature name or slug"),
      pageName: z.string().describe("Page name (e.g. 'Login Page', 'Dashboard')"),
      route: z.string().describe("Page route (e.g. /login, /dashboard)"),
      sections: z.array(z.object({
        name: z.string().describe("Section name (e.g. 'Header', 'Login Form', 'Stats Grid')"),
        role: z.enum(["header", "nav", "sidebar", "main", "footer", "modal", "form", "list", "card", "section"]),
        description: z.string().describe("What this section contains"),
        components: z.array(z.string()).describe("Component names needed (e.g. ['LoginForm', 'SocialButtons'])"),
        position: z.string().optional().describe("Position hint (e.g. 'top', 'left', 'center')"),
      })).describe("Layout sections from top to bottom"),
    },
    async ({ feature, pageName, route, sections }) => {
      const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

      const wireframe = buildWireframe(pageName, route, sections as WireframeSection[]);
      const md = wireframeToMarkdown(wireframe);

      // Extract components from wireframe
      const extracted = extractComponentsFromWireframe(wireframe);

      // Save wireframe to feature
      const existingFeature = await getFeature(specDir, slug);
      if (existingFeature) {
        await addPageToFeature(specDir, slug, {
          route,
          description: `${pageName}\n\n${md}`,
          components: extracted.map((c) => c.name),
        });

        for (const comp of extracted) {
          const exists = existingFeature.components.some((c) => c.name === comp.name);
          if (!exists) {
            await addComponentToFeature(specDir, slug, {
              name: comp.name,
              description: `${comp.role} component (from wireframe)`,
              props: [],
              isNew: true,
            });
          }
        }
      }

      // Also save standalone wireframe file
      const wireframeDir = path.join(specDir, "wireframes");
      await fs.mkdir(wireframeDir, { recursive: true });
      await fs.writeFile(path.join(wireframeDir, `${slug}-${route.replace(/\//g, "-").replace(/^-/, "")}.md`), md);

      return {
        content: [{
          type: "text" as const,
          text: `${md}\n\n_${extracted.length} components extracted from wireframe._`,
        }],
      };
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
