import { FrameworkAdapter } from "../types.js";
import { AnalysisConfig, ProjectRules } from "../../types/spec.js";
import { RouteInfo } from "../../types/page.js";
import { ComponentInfo, PropInfo, ImportInfo } from "../../types/component.js";
import { ProjectStructure, TechStackInfo } from "../../types/project.js";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

export class AngularAdapter implements FrameworkAdapter {
  id = "angular";
  name = "Angular";

  async detectStructure(projectRoot: string): Promise<ProjectStructure> {
    return {
      srcDir: "src",
      pagesDir: "src/app",
      componentsDir: "src/app",
      apiDir: null,
      publicDir: "src/assets",
      configFiles: await findConfigs(projectRoot),
    };
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
    if ("@ngrx/store" in allDeps) stack.stateManagement!.push("NgRx");
    if ("@angular/material" in allDeps) stack.styling!.push("Angular Material");
    if ("karma" in allDeps) stack.testing!.push("Karma");
    if ("jest" in allDeps) stack.testing!.push("Jest");

    return stack;
  }

  async extractRoutes(projectRoot: string, _config: AnalysisConfig): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];
    const routingFiles = await glob("src/app/**/*routing*.ts", { cwd: projectRoot, posix: true });
    const routeModuleFiles = await glob("src/app/**/*-routes.ts", { cwd: projectRoot, posix: true });

    for (const file of [...routingFiles, ...routeModuleFiles]) {
      try {
        const content = await fs.readFile(path.join(projectRoot, file), "utf-8");
        const routeMatches = content.matchAll(/path\s*:\s*['"]([^'"]*)['"]/g);
        for (const match of routeMatches) {
          if (match[1] === "**") continue; // Wildcard route
          routes.push({
            path: "/" + match[1],
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
    if (!filePath.endsWith(".component.ts")) return null;
    return extractAngularComponent(filePath, content);
  }

  async detectConventions(_projectRoot: string, _config: AnalysisConfig): Promise<Partial<ProjectRules>> {
    return {
      naming: {
        components: "PascalCase",
        files: "kebab-case",
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
    return ["src/app/**/*.component.ts"];
  }

  getPageGlobs(): string[] {
    return ["src/app/**/*.component.ts"];
  }
}

function extractAngularComponent(filePath: string, content: string): ComponentInfo {
  const name = inferAngularName(content, filePath);

  // Extract @Input() properties
  const props: PropInfo[] = [];
  const inputRegex = /@Input\(\)\s+(\w+)(?:\s*:\s*(\w+(?:<[^>]+>)?))?(?:\s*=\s*([^;]+))?/g;
  let match;
  while ((match = inputRegex.exec(content)) !== null) {
    props.push({
      name: match[1],
      type: match[2] || "unknown",
      required: !match[3],
      defaultValue: match[3]?.trim() || null,
      description: "",
    });
  }

  // Signal inputs (Angular 17+)
  const signalInputRegex = /(\w+)\s*=\s*input(?:\.required)?(?:<([^>]+)>)?\(/g;
  while ((match = signalInputRegex.exec(content)) !== null) {
    props.push({
      name: match[1],
      type: match[2] || "unknown",
      required: content.includes(`${match[1]} = input.required`),
      defaultValue: null,
      description: "",
    });
  }

  const imports = extractAngularImports(content);
  const children = extractAngularChildren(content);

  return {
    name,
    filePath,
    type: "component",
    props,
    state: [],
    events: [],
    slots: [],
    imports,
    children,
    exportType: "named",
    isClientComponent: true,
    isServerComponent: false,
    description: "",
    loc: { start: 1, end: content.split("\n").length },
  };
}

function inferAngularName(content: string, filePath: string): string {
  const classMatch = content.match(/export\s+class\s+(\w+)/);
  if (classMatch) return classMatch[1];
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1].replace(".component.ts", "");
}

function extractAngularImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const regex = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\}\s*)?from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push({
      source: match[3],
      specifiers: [...(match[1] ? [match[1]] : []), ...(match[2] ? match[2].split(",").map((s) => s.trim()).filter(Boolean) : [])],
      isDefault: !!match[1],
      isType: false,
    });
  }
  return imports;
}

function extractAngularChildren(content: string): string[] {
  const children = new Set<string>();
  // From template string
  const templateMatch = content.match(/template\s*:\s*`([\s\S]*?)`/);
  if (templateMatch) {
    const regex = /<(?:app-)?([a-z][\w-]*)/g;
    let match;
    while ((match = regex.exec(templateMatch[1])) !== null) {
      if (match[1].includes("-")) {
        const pascal = match[1].split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
        children.add(pascal);
      }
    }
  }
  // From imports array in @Component
  const importsMatch = content.match(/imports\s*:\s*\[([^\]]+)\]/);
  if (importsMatch) {
    const names = importsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      if (name.endsWith("Component") && !name.startsWith("'")) children.add(name);
    }
  }
  return Array.from(children);
}

async function findConfigs(projectRoot: string): Promise<string[]> {
  const configs: string[] = [];
  const candidates = ["angular.json", "tsconfig.json", "tsconfig.app.json"];
  for (const cfg of candidates) {
    try {
      await fs.access(path.join(projectRoot, cfg));
      configs.push(cfg);
    } catch {}
  }
  return configs;
}

function inferName(routePath: string): string {
  if (!routePath || routePath === "") return "Home";
  const parts = routePath.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last.startsWith(":")) return parts.length > 1 ? parts[parts.length - 2] : "Dynamic";
  return last.charAt(0).toUpperCase() + last.slice(1);
}
