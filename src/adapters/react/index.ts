import { FrameworkAdapter } from "../types.js";
import { AnalysisConfig, ProjectRules } from "../../types/spec.js";
import { RouteInfo } from "../../types/page.js";
import { ComponentInfo } from "../../types/component.js";
import { ProjectStructure, TechStackInfo } from "../../types/project.js";
import { extractComponentFromFile } from "../../parsers/typescript.js";
import { NextjsAdapter } from "../nextjs/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

// React adapter extends NextjsAdapter for shared tech stack detection
const nextjsHelper = new NextjsAdapter();

export class ReactAdapter implements FrameworkAdapter {
  id = "react";
  name = "React";

  async detectStructure(projectRoot: string): Promise<ProjectStructure> {
    return nextjsHelper.detectStructure(projectRoot);
  }

  async detectTechStack(projectRoot: string): Promise<Partial<TechStackInfo>> {
    return nextjsHelper.detectTechStack(projectRoot);
  }

  async extractRoutes(projectRoot: string, _config: AnalysisConfig): Promise<RouteInfo[]> {
    // Try to find React Router config
    const routes: RouteInfo[] = [];

    // Search for route definitions in common patterns
    const routeFiles = await glob("src/**/*.{tsx,jsx,ts,js}", {
      cwd: projectRoot,
      posix: true,
    });

    for (const file of routeFiles) {
      try {
        const content = await fs.readFile(path.join(projectRoot, file), "utf-8");
        if (content.includes("createBrowserRouter") || content.includes("<Route") || content.includes("useRoutes")) {
          // Extract routes from React Router patterns
          const routeMatches = content.matchAll(
            /path\s*[:=]\s*["']([^"']+)["']/g
          );
          for (const match of routeMatches) {
            routes.push({
              path: match[1],
              filePath: file,
              name: inferName(match[1]),
              layout: null,
              isApiRoute: false,
              isDynamic: match[1].includes(":"),
              params: extractParams(match[1]),
              children: [],
              metadata: { title: null, description: null, isProtected: false, middleware: [] },
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return routes;
  }

  async extractComponent(filePath: string, content: string): Promise<ComponentInfo | null> {
    return extractComponentFromFile(filePath, content);
  }

  async detectConventions(projectRoot: string, config: AnalysisConfig): Promise<Partial<ProjectRules>> {
    return nextjsHelper.detectConventions(projectRoot, config);
  }

  getComponentGlobs(): string[] {
    return [
      "src/components/**/*.{tsx,jsx}",
      "src/**/*.{tsx,jsx}",
      "components/**/*.{tsx,jsx}",
    ];
  }

  getPageGlobs(): string[] {
    return [
      "src/pages/**/*.{tsx,jsx}",
      "src/views/**/*.{tsx,jsx}",
      "src/screens/**/*.{tsx,jsx}",
    ];
  }
}

function inferName(routePath: string): string {
  if (routePath === "/") return "Home";
  const parts = routePath.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last.startsWith(":")) return parts.length > 1 ? parts[parts.length - 2] : "Dynamic";
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function extractParams(routePath: string): string[] {
  return (routePath.match(/:(\w+)/g) || []).map((p) => p.slice(1));
}
