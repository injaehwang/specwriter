import { FrameworkAdapter } from "../types.js";
import { AnalysisConfig, ProjectRules } from "../../types/spec.js";
import { RouteInfo } from "../../types/page.js";
import { ComponentInfo } from "../../types/component.js";
import { ProjectStructure, TechStackInfo } from "../../types/project.js";
import { extractComponentFromFile } from "../../parsers/typescript.js";
import fs from "node:fs/promises";
import path from "node:path";

export class GenericAdapter implements FrameworkAdapter {
  id = "generic";
  name = "Generic Project";

  async detectStructure(projectRoot: string): Promise<ProjectStructure> {
    const dirs = ["src", "app", "pages", "components", "lib", "public", "api"];
    const found: Partial<ProjectStructure> = {
      srcDir: "src",
      pagesDir: null,
      componentsDir: null,
      apiDir: null,
      publicDir: null,
      configFiles: [],
    };

    for (const dir of dirs) {
      try {
        await fs.access(path.join(projectRoot, dir));
        if (dir === "pages") found.pagesDir = dir;
        if (dir === "components") found.componentsDir = dir;
        if (dir === "api") found.apiDir = dir;
        if (dir === "public") found.publicDir = dir;
      } catch {
        // Dir doesn't exist
      }
    }

    // Find config files
    const configPatterns = [
      "tsconfig.json", "jsconfig.json", "vite.config.ts", "vite.config.js",
      "webpack.config.js", "rollup.config.js", "esbuild.config.js",
      ".eslintrc.js", ".eslintrc.json", ".prettierrc",
    ];

    for (const cfg of configPatterns) {
      try {
        await fs.access(path.join(projectRoot, cfg));
        found.configFiles!.push(cfg);
      } catch {
        // Doesn't exist
      }
    }

    return found as ProjectStructure;
  }

  async detectTechStack(_projectRoot: string): Promise<Partial<TechStackInfo>> {
    return {};
  }

  async extractRoutes(_projectRoot: string, _config: AnalysisConfig): Promise<RouteInfo[]> {
    return [];
  }

  async extractComponent(filePath: string, content: string): Promise<ComponentInfo | null> {
    if (filePath.endsWith(".vue")) {
      const { extractVueComponent } = await import("../../parsers/vue-sfc.js");
      return extractVueComponent(filePath, content);
    }
    return extractComponentFromFile(filePath, content);
  }

  async detectConventions(_projectRoot: string, _config: AnalysisConfig): Promise<Partial<ProjectRules>> {
    return {};
  }

  getComponentGlobs(): string[] {
    return ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte"];
  }

  getPageGlobs(): string[] {
    return [];
  }
}
