import { FrameworkAdapter } from "../types.js";
import { AnalysisConfig, ProjectRules, NamingConventions } from "../../types/spec.js";
import { RouteInfo } from "../../types/page.js";
import { ComponentInfo } from "../../types/component.js";
import { ProjectStructure, TechStackInfo } from "../../types/project.js";
import { extractComponentFromFile } from "../../parsers/typescript.js";
import { extractAppRouterRoutes, extractPagesRouterRoutes } from "./routes.js";
import fs from "node:fs/promises";
import path from "node:path";

export class NextjsAdapter implements FrameworkAdapter {
  id = "nextjs";
  name = "Next.js";

  async detectStructure(projectRoot: string): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      srcDir: "src",
      pagesDir: null,
      componentsDir: null,
      apiDir: null,
      publicDir: null,
      configFiles: [],
    };

    // Check for src/ prefix
    const hasSrc = await dirExists(path.join(projectRoot, "src"));

    // Detect App Router vs Pages Router
    const hasAppDir = await dirExists(path.join(projectRoot, hasSrc ? "src/app" : "app"));
    const hasPagesDir = await dirExists(path.join(projectRoot, hasSrc ? "src/pages" : "pages"));

    if (hasAppDir) {
      structure.pagesDir = hasSrc ? "src/app" : "app";
      structure.apiDir = hasSrc ? "src/app/api" : "app/api";
    }
    if (hasPagesDir) {
      structure.pagesDir = hasSrc ? "src/pages" : "pages";
      structure.apiDir = hasSrc ? "src/pages/api" : "pages/api";
    }

    // Components directory
    const componentsDirs = [
      "src/components", "components",
      "src/app/components", "app/components",
    ];
    for (const dir of componentsDirs) {
      if (await dirExists(path.join(projectRoot, dir))) {
        structure.componentsDir = dir;
        break;
      }
    }

    // Public directory
    if (await dirExists(path.join(projectRoot, "public"))) {
      structure.publicDir = "public";
    }

    // Config files
    const configs = [
      "next.config.js", "next.config.ts", "next.config.mjs",
      "tsconfig.json", "tailwind.config.ts", "tailwind.config.js",
      "postcss.config.js", "postcss.config.mjs",
    ];
    for (const cfg of configs) {
      if (await fileExists(path.join(projectRoot, cfg))) {
        structure.configFiles.push(cfg);
      }
    }

    return structure;
  }

  async detectTechStack(projectRoot: string): Promise<Partial<TechStackInfo>> {
    const stack: Partial<TechStackInfo> = {
      styling: [],
      stateManagement: [],
      testing: [],
      linting: [],
    };

    let pkg: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(path.join(projectRoot, "package.json"), "utf-8");
      pkg = JSON.parse(content);
    } catch {
      return stack;
    }

    const allDeps = {
      ...(pkg.dependencies as Record<string, string> || {}),
      ...(pkg.devDependencies as Record<string, string> || {}),
    };

    // Styling
    if ("tailwindcss" in allDeps) stack.styling!.push("Tailwind CSS");
    if ("styled-components" in allDeps) stack.styling!.push("Styled Components");
    if ("@emotion/react" in allDeps) stack.styling!.push("Emotion");
    if ("sass" in allDeps) stack.styling!.push("Sass/SCSS");
    if ("@mui/material" in allDeps) stack.styling!.push("Material UI");
    if ("@chakra-ui/react" in allDeps) stack.styling!.push("Chakra UI");
    if ("antd" in allDeps) stack.styling!.push("Ant Design");

    // State management
    if ("zustand" in allDeps) stack.stateManagement!.push("Zustand");
    if ("@reduxjs/toolkit" in allDeps || "redux" in allDeps) stack.stateManagement!.push("Redux");
    if ("recoil" in allDeps) stack.stateManagement!.push("Recoil");
    if ("jotai" in allDeps) stack.stateManagement!.push("Jotai");
    if ("@tanstack/react-query" in allDeps) stack.stateManagement!.push("TanStack Query");
    if ("swr" in allDeps) stack.stateManagement!.push("SWR");

    // Testing
    if ("vitest" in allDeps) stack.testing!.push("Vitest");
    if ("jest" in allDeps) stack.testing!.push("Jest");
    if ("@testing-library/react" in allDeps) stack.testing!.push("Testing Library");
    if ("cypress" in allDeps) stack.testing!.push("Cypress");
    if ("playwright" in allDeps || "@playwright/test" in allDeps) stack.testing!.push("Playwright");

    // Linting
    if ("eslint" in allDeps) stack.linting!.push("ESLint");
    if ("prettier" in allDeps) stack.linting!.push("Prettier");
    if ("biome" in allDeps || "@biomejs/biome" in allDeps) stack.linting!.push("Biome");

    // Language detection
    if ("typescript" in allDeps) {
      stack.language = "typescript";
    }

    return stack;
  }

  async extractRoutes(projectRoot: string, _config: AnalysisConfig): Promise<RouteInfo[]> {
    // Try App Router first, then Pages Router
    const appRoutes = await extractAppRouterRoutes(projectRoot);
    if (appRoutes.length > 0) return appRoutes;

    const pagesRoutes = await extractPagesRouterRoutes(projectRoot);
    return pagesRoutes;
  }

  async extractComponent(filePath: string, content: string): Promise<ComponentInfo | null> {
    return extractComponentFromFile(filePath, content);
  }

  async detectConventions(projectRoot: string, _config: AnalysisConfig): Promise<Partial<ProjectRules>> {
    return {
      naming: {
        components: "PascalCase",
        files: "kebab-case",
        functions: "camelCase",
        variables: "camelCase",
        cssClasses: "unknown",
        directories: "kebab-case",
      } as NamingConventions,
      patterns: [],
      fileOrganization: [],
      importConventions: [],
    };
  }

  getComponentGlobs(): string[] {
    return [
      "src/components/**/*.{tsx,jsx}",
      "components/**/*.{tsx,jsx}",
      "src/app/**/components/**/*.{tsx,jsx}",
      "app/**/components/**/*.{tsx,jsx}",
    ];
  }

  getPageGlobs(): string[] {
    return [
      "app/**/page.{tsx,jsx,ts,js}",
      "src/app/**/page.{tsx,jsx,ts,js}",
      "pages/**/*.{tsx,jsx,ts,js}",
      "src/pages/**/*.{tsx,jsx,ts,js}",
    ];
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
