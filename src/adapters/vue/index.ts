import { FrameworkAdapter } from "../types.js";
import { AnalysisConfig, ProjectRules } from "../../types/spec.js";
import { RouteInfo } from "../../types/page.js";
import { ComponentInfo } from "../../types/component.js";
import { ProjectStructure, TechStackInfo } from "../../types/project.js";
import { extractVueComponent } from "../../parsers/vue-sfc.js";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

export class VueAdapter implements FrameworkAdapter {
  id = "vue";
  name = "Vue";

  async detectStructure(projectRoot: string): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      srcDir: "src",
      pagesDir: null,
      componentsDir: null,
      apiDir: null,
      publicDir: null,
      configFiles: [],
    };

    const dirs = [
      { path: "src/views", key: "pagesDir" },
      { path: "src/pages", key: "pagesDir" },
      { path: "src/components", key: "componentsDir" },
      { path: "public", key: "publicDir" },
    ];

    for (const dir of dirs) {
      try {
        await fs.access(path.join(projectRoot, dir.path));
        (structure as unknown as Record<string, unknown>)[dir.key] = dir.path;
      } catch {}
    }

    const configs = ["vue.config.js", "vue.config.ts", "vite.config.ts", "vite.config.js", "tsconfig.json"];
    for (const cfg of configs) {
      try {
        await fs.access(path.join(projectRoot, cfg));
        structure.configFiles.push(cfg);
      } catch {}
    }

    return structure;
  }

  async detectTechStack(projectRoot: string): Promise<Partial<TechStackInfo>> {
    const stack: Partial<TechStackInfo> = { styling: [], stateManagement: [], testing: [], linting: [] };

    let pkg: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(path.join(projectRoot, "package.json"), "utf-8");
      pkg = JSON.parse(content);
    } catch {
      return stack;
    }

    const allDeps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };

    if ("pinia" in allDeps) stack.stateManagement!.push("Pinia");
    if ("vuex" in allDeps) stack.stateManagement!.push("Vuex");
    if ("tailwindcss" in allDeps) stack.styling!.push("Tailwind CSS");
    if ("vuetify" in allDeps) stack.styling!.push("Vuetify");
    if ("element-plus" in allDeps) stack.styling!.push("Element Plus");
    if ("vitest" in allDeps) stack.testing!.push("Vitest");
    if ("@vue/test-utils" in allDeps) stack.testing!.push("Vue Test Utils");

    return stack;
  }

  async extractRoutes(projectRoot: string, _config: AnalysisConfig): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];
    const routerFiles = await glob("src/router/**/*.{ts,js}", { cwd: projectRoot, posix: true });

    for (const file of routerFiles) {
      try {
        const content = await fs.readFile(path.join(projectRoot, file), "utf-8");
        const routeMatches = content.matchAll(/path\s*:\s*["']([^"']+)["']/g);
        for (const match of routeMatches) {
          routes.push({
            path: match[1],
            filePath: file,
            name: inferName(match[1]),
            layout: null,
            isApiRoute: false,
            isDynamic: match[1].includes(":"),
            params: (match[1].match(/:(\w+)/g) || []).map((p) => p.slice(1)),
            children: [],
            metadata: { title: null, description: null, isProtected: false, middleware: [] },
          });
        }
      } catch {}
    }

    return routes;
  }

  async extractComponent(filePath: string, content: string): Promise<ComponentInfo | null> {
    if (filePath.endsWith(".vue")) {
      return extractVueComponent(filePath, content);
    }
    return null;
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
    return ["src/components/**/*.vue", "src/**/*.vue"];
  }

  getPageGlobs(): string[] {
    return ["src/views/**/*.vue", "src/pages/**/*.vue"];
  }
}

function inferName(routePath: string): string {
  if (routePath === "/") return "Home";
  const parts = routePath.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last.startsWith(":")) return parts.length > 1 ? parts[parts.length - 2] : "Dynamic";
  return last.charAt(0).toUpperCase() + last.slice(1);
}
