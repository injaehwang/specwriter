import { FrameworkAdapter } from "../types.js";
import { AnalysisConfig, ProjectRules } from "../../types/spec.js";
import { RouteInfo } from "../../types/page.js";
import { ComponentInfo } from "../../types/component.js";
import { ProjectStructure, TechStackInfo } from "../../types/project.js";
import { extractVueComponent } from "../../parsers/vue-sfc.js";
import { VueAdapter } from "../vue/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

const vueHelper = new VueAdapter();

export class NuxtAdapter implements FrameworkAdapter {
  id = "nuxt";
  name = "Nuxt";

  async detectStructure(projectRoot: string): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      srcDir: ".",
      pagesDir: "pages",
      componentsDir: "components",
      apiDir: "server/api",
      publicDir: "public",
      configFiles: [],
    };

    const configs = ["nuxt.config.ts", "nuxt.config.js", "tsconfig.json"];
    for (const cfg of configs) {
      try {
        await fs.access(path.join(projectRoot, cfg));
        structure.configFiles.push(cfg);
      } catch {}
    }

    return structure;
  }

  async detectTechStack(projectRoot: string): Promise<Partial<TechStackInfo>> {
    return vueHelper.detectTechStack(projectRoot);
  }

  async extractRoutes(projectRoot: string, _config: AnalysisConfig): Promise<RouteInfo[]> {
    const pagesDir = path.join(projectRoot, "pages");
    try {
      await fs.access(pagesDir);
    } catch {
      return [];
    }

    const pageFiles = await glob("**/*.vue", { cwd: pagesDir, posix: true });
    const routes: RouteInfo[] = [];

    for (const file of pageFiles) {
      const segments = file.replace(/\.vue$/, "").split("/");
      const lastSegment = segments[segments.length - 1];
      if (lastSegment === "index") segments.pop();

      const routePath = "/" + segments
        .map((s) => {
          if (s.startsWith("[...") && s.endsWith("]")) return `*`;
          if (s.startsWith("[") && s.endsWith("]")) return `:${s.slice(1, -1)}`;
          return s;
        })
        .join("/");

      routes.push({
        path: routePath || "/",
        filePath: path.join("pages", file),
        name: inferName(routePath || "/"),
        layout: null,
        isApiRoute: false,
        isDynamic: routePath.includes(":"),
        params: segments
          .filter((s) => s.startsWith("["))
          .map((s) => s.replace(/^\[\.{0,3}/, "").replace(/\]$/, "")),
        children: [],
        metadata: { title: null, description: null, isProtected: false, middleware: [] },
      });
    }

    // Server API routes
    const serverDir = path.join(projectRoot, "server", "api");
    try {
      await fs.access(serverDir);
      const apiFiles = await glob("**/*.{ts,js}", { cwd: serverDir, posix: true });
      for (const file of apiFiles) {
        const routePath = "/api/" + file.replace(/\.[jt]s$/, "").replace(/\/index$/, "");
        routes.push({
          path: routePath,
          filePath: path.join("server/api", file),
          name: inferName(routePath) + " (API)",
          layout: null,
          isApiRoute: true,
          isDynamic: false,
          params: [],
          children: [],
          metadata: { title: null, description: null, isProtected: false, middleware: [] },
        });
      }
    } catch {}

    return routes.sort((a, b) => a.path.localeCompare(b.path));
  }

  async extractComponent(filePath: string, content: string): Promise<ComponentInfo | null> {
    if (filePath.endsWith(".vue")) return extractVueComponent(filePath, content);
    return null;
  }

  async detectConventions(projectRoot: string, config: AnalysisConfig): Promise<Partial<ProjectRules>> {
    return vueHelper.detectConventions(projectRoot, config);
  }

  getComponentGlobs(): string[] {
    return ["components/**/*.vue"];
  }

  getPageGlobs(): string[] {
    return ["pages/**/*.vue"];
  }
}

function inferName(routePath: string): string {
  if (routePath === "/") return "Home";
  const parts = routePath.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last.startsWith(":")) return parts.length > 1 ? parts[parts.length - 2] : "Dynamic";
  return last.charAt(0).toUpperCase() + last.slice(1);
}
