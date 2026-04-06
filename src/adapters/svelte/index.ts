import { FrameworkAdapter } from "../types.js";
import { AnalysisConfig, ProjectRules } from "../../types/spec.js";
import { RouteInfo } from "../../types/page.js";
import { ComponentInfo, PropInfo, StateInfo, ImportInfo } from "../../types/component.js";
import { ProjectStructure, TechStackInfo } from "../../types/project.js";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

export class SvelteAdapter implements FrameworkAdapter {
  id = "svelte";
  name = "Svelte / SvelteKit";

  async detectStructure(projectRoot: string): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      srcDir: "src",
      pagesDir: "src/routes",
      componentsDir: "src/lib/components",
      apiDir: null,
      publicDir: "static",
      configFiles: [],
    };

    const configs = ["svelte.config.js", "svelte.config.ts", "vite.config.ts", "tsconfig.json"];
    for (const cfg of configs) {
      try {
        await fs.access(path.join(projectRoot, cfg));
        structure.configFiles.push(cfg);
      } catch {}
    }

    return structure;
  }

  async detectTechStack(_projectRoot: string): Promise<Partial<TechStackInfo>> {
    return { styling: [], stateManagement: [], testing: [], linting: [] };
  }

  async extractRoutes(projectRoot: string, _config: AnalysisConfig): Promise<RouteInfo[]> {
    const routesDir = path.join(projectRoot, "src", "routes");
    try {
      await fs.access(routesDir);
    } catch {
      return [];
    }

    const pageFiles = await glob("**/{+page.svelte,+server.ts,+server.js}", { cwd: routesDir, posix: true });
    const routes: RouteInfo[] = [];

    for (const file of pageFiles) {
      const isApi = file.endsWith("+server.ts") || file.endsWith("+server.js");
      const segments = file.split("/").slice(0, -1);

      const routePath = "/" + segments
        .filter((s) => !s.startsWith("("))
        .map((s) => {
          if (s.startsWith("[...") && s.endsWith("]")) return `*`;
          if (s.startsWith("[") && s.endsWith("]")) return `:${s.slice(1, -1)}`;
          return s;
        })
        .join("/");

      routes.push({
        path: routePath || "/",
        filePath: path.join("src/routes", file),
        name: inferName(routePath || "/"),
        layout: null,
        isApiRoute: isApi,
        isDynamic: routePath.includes(":"),
        params: segments
          .filter((s) => s.startsWith("["))
          .map((s) => s.replace(/^\[\.{0,3}/, "").replace(/\]$/, "")),
        children: [],
        metadata: { title: null, description: null, isProtected: false, middleware: [] },
      });
    }

    return routes.sort((a, b) => a.path.localeCompare(b.path));
  }

  async extractComponent(filePath: string, content: string): Promise<ComponentInfo | null> {
    if (!filePath.endsWith(".svelte")) return null;
    return extractSvelteComponent(filePath, content);
  }

  async detectConventions(_projectRoot: string, _config: AnalysisConfig): Promise<Partial<ProjectRules>> {
    return {
      naming: {
        components: "PascalCase",
        files: "PascalCase",
        functions: "camelCase",
        variables: "camelCase",
        cssClasses: "unknown",
        directories: "kebab-case",
      },
      patterns: [],
      fileOrganization: [],
      importConventions: [],
    };
  }

  getComponentGlobs(): string[] {
    return ["src/lib/**/*.svelte", "src/components/**/*.svelte"];
  }

  getPageGlobs(): string[] {
    return ["src/routes/**/{+page,+layout}.svelte"];
  }
}

function extractSvelteComponent(filePath: string, content: string): ComponentInfo {
  const name = inferSvelteName(filePath);
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const script = scriptMatch ? scriptMatch[1] : "";
  const templateContent = content.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");

  const props = extractSvelteProps(script);
  const state = extractSvelteState(script);
  const imports = extractSvelteImports(script);
  const children = extractSvelteChildren(templateContent);

  return {
    name,
    filePath,
    type: filePath.includes("+page") ? "page" : filePath.includes("+layout") ? "layout" : "component",
    props,
    state,
    events: [],
    slots: [],
    imports,
    children,
    exportType: "default",
    isClientComponent: true,
    isServerComponent: false,
    description: "",
    loc: { start: 1, end: content.split("\n").length },
  };
}

function extractSvelteProps(script: string): PropInfo[] {
  const props: PropInfo[] = [];
  // Svelte 5 runes: let { prop1, prop2 } = $props()
  const runesMatch = script.match(/let\s+\{([^}]+)\}\s*=\s*\$props\(\)/);
  if (runesMatch) {
    const entries = runesMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      const defaultMatch = entry.match(/^(\w+)\s*=\s*(.+)$/);
      if (defaultMatch) {
        props.push({ name: defaultMatch[1], type: "unknown", required: false, defaultValue: defaultMatch[2].trim(), description: "" });
      } else {
        props.push({ name: entry, type: "unknown", required: true, defaultValue: null, description: "" });
      }
    }
    return props;
  }

  // Svelte 4: export let propName
  const exportRegex = /export\s+let\s+(\w+)(?:\s*:\s*(\w+))?(?:\s*=\s*([^;]+))?/g;
  let match;
  while ((match = exportRegex.exec(script)) !== null) {
    props.push({
      name: match[1],
      type: match[2] || "unknown",
      required: !match[3],
      defaultValue: match[3]?.trim() || null,
      description: "",
    });
  }
  return props;
}

function extractSvelteState(script: string): StateInfo[] {
  const states: StateInfo[] = [];
  // Svelte 5: let x = $state(value)
  const stateRegex = /let\s+(\w+)\s*=\s*\$state(?:<([^>]+)>)?\(([^)]*)\)/g;
  let match;
  while ((match = stateRegex.exec(script)) !== null) {
    states.push({ name: match[1], type: match[2] || "unknown", initialValue: match[3] || null, setter: null, source: "signal" });
  }

  // Svelte 4: let x = value (reactive by default)
  const letRegex = /(?<!export\s+)let\s+(\w+)\s*=\s*([^;]+)/g;
  while ((match = letRegex.exec(script)) !== null) {
    if (!match[2].includes("$state") && !match[2].includes("$props") && !match[2].includes("$derived")) {
      states.push({ name: match[1], type: "unknown", initialValue: match[2].trim(), setter: null, source: "other" });
    }
  }
  return states;
}

function extractSvelteImports(script: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const regex = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\}\s*)?from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(script)) !== null) {
    imports.push({
      source: match[3],
      specifiers: [...(match[1] ? [match[1]] : []), ...(match[2] ? match[2].split(",").map((s) => s.trim()).filter(Boolean) : [])],
      isDefault: !!match[1],
      isType: false,
    });
  }
  return imports;
}

function extractSvelteChildren(template: string): string[] {
  const children = new Set<string>();
  const regex = /<([A-Z][a-zA-Z0-9]*)/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    children.add(match[1]);
  }
  return Array.from(children);
}

function inferSvelteName(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1];
  if (fileName.startsWith("+")) return parts[parts.length - 2] || fileName.replace(".svelte", "");
  return fileName.replace(".svelte", "");
}

function inferName(routePath: string): string {
  if (routePath === "/") return "Home";
  const parts = routePath.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last.startsWith(":")) return parts.length > 1 ? parts[parts.length - 2] : "Dynamic";
  return last.charAt(0).toUpperCase() + last.slice(1);
}
