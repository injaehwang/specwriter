import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { AnalysisConfig, SpecOutput } from "../types/spec.js";
import { ProjectInfo, FrameworkInfo } from "../types/project.js";
import { ComponentInfo, ComponentGraph } from "../types/component.js";
import { PageTree, PageInfo } from "../types/page.js";
import { detectFramework } from "../detect/index.js";
import { readPackageJson } from "../detect/package-json.js";
import { getAdapter } from "../adapters/registry.js";
import { assignComponentRoles } from "../wireframe/layout-detector.js";
import { buildWireframeFromComponents } from "../wireframe/ascii-renderer.js";
import { generateOutput } from "../generators/index.js";
import { analyzeTooling } from "../analyzers/tooling.js";
import { recommendMcpServers } from "../analyzers/mcp-recommendations.js";

export async function runAnalysis(
  config: AnalysisConfig,
  verbose: boolean
): Promise<void> {
  const startTime = Date.now();

  log(verbose, "Detecting framework...");
  const detection = await detectFramework(config.root);
  const frameworkId =
    config.framework !== "auto" ? (config.framework as any) : detection.frameworkId;

  log(verbose, `  Framework: ${frameworkId} (${(detection.confidence * 100).toFixed(0)}%)`);

  const adapter = getAdapter(frameworkId);

  // Detect project info
  log(verbose, "Analyzing project structure...");
  const [structure, techStack, pkg] = await Promise.all([
    adapter.detectStructure(config.root),
    adapter.detectTechStack(config.root),
    readPackageJson(config.root),
  ]);

  const frameworkInfo: FrameworkInfo = {
    id: frameworkId,
    name: adapter.name,
    version: findDependencyVersion(pkg, frameworkId),
    confidence: detection.confidence,
    routingStrategy: frameworkId === "nextjs" || frameworkId === "nuxt" || frameworkId === "sveltekit"
      ? "file-based"
      : frameworkId === "generic" ? "unknown" : "config-based",
    features: detection.evidence,
  };

  const projectInfo: ProjectInfo = {
    name: (pkg?.name as string) || path.basename(config.root),
    version: (pkg?.version as string) || "0.0.0",
    description: (pkg?.description as string) || "",
    root: config.root,
    framework: frameworkInfo,
    techStack: {
      language: (techStack.language as any) || detectLanguage(config.root),
      styling: techStack.styling || [],
      stateManagement: techStack.stateManagement || [],
      testing: techStack.testing || [],
      buildTool: detectBuildTool(pkg),
      packageManager: detectPackageManager(config.root),
      linting: techStack.linting || [],
      otherLibraries: [],
    },
    structure,
  };

  // Extract routes
  log(verbose, "Extracting routes...");
  const routes = await adapter.extractRoutes(config.root, config);
  log(verbose, `  Found ${routes.length} routes`);

  // Extract components
  log(verbose, "Extracting components...");
  const components = await extractAllComponents(config, adapter, verbose);
  log(verbose, `  Found ${components.length} components`);

  // Detect conventions
  log(verbose, "Detecting conventions...");
  const conventions = await adapter.detectConventions(config.root, config);

  // Analyze tooling and recommend MCP servers
  log(verbose, "Analyzing development tooling...");
  const [tooling, mcpRecommendations] = await Promise.all([
    analyzeTooling(config.root),
    recommendMcpServers(config.root),
  ]);
  if (verbose && mcpRecommendations.length > 0) {
    log(verbose, `  Recommended MCP servers: ${mcpRecommendations.map(r => r.name).join(", ")}`);
  }

  // Build page tree with wireframes
  log(verbose, "Building page tree...");
  const pages: PageInfo[] = routes
    .filter((r) => !r.isApiRoute)
    .map((route) => {
      // Find components used in this page
      const pageComponents = findPageComponents(route.filePath, components);
      const componentRefs = assignComponentRoles(pageComponents);

      // Build wireframe
      const wireframe = config.wireframes
        ? buildWireframeFromComponents(
            componentRefs.map((c) => ({ name: c.name, role: c.role }))
          )
        : null;

      return {
        route,
        components: componentRefs,
        wireframe,
        description: "",
        dataFetching: [],
      };
    });

  const pageTree: PageTree = {
    pages,
    routes,
    layouts: extractLayouts(components),
  };

  // Build component graph
  const componentGraph = buildComponentGraph(components);

  // Build full spec output
  const spec: SpecOutput = {
    manifest: {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      toolVersion: "0.1.0",
      frameworkDetected: frameworkId,
      analyzedFiles: components.length,
      duration: Date.now() - startTime,
    },
    project: projectInfo,
    rules: {
      naming: conventions.naming || {
        components: "unknown",
        files: "unknown",
        functions: "unknown",
        variables: "unknown",
        cssClasses: "unknown",
        directories: "unknown",
      },
      patterns: conventions.patterns || [],
      fileOrganization: conventions.fileOrganization || [],
      importConventions: conventions.importConventions || [],
    },
    pageTree,
    components,
    componentGraph,
    tooling,
    mcpRecommendations,
  };

  // Generate output files
  log(verbose, "Generating output...");
  await generateOutput(spec, config);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n  Done! Analyzed ${components.length} components, ${routes.length} routes in ${duration}s`
  );
  console.log(`  Output: ${path.resolve(config.root, config.output)}/`);
  console.log("");
}

async function extractAllComponents(
  config: AnalysisConfig,
  adapter: ReturnType<typeof getAdapter>,
  verbose: boolean
): Promise<ComponentInfo[]> {
  const componentGlobs = adapter.getComponentGlobs();
  const pageGlobs = adapter.getPageGlobs();
  const allGlobs = [...new Set([...componentGlobs, ...pageGlobs])];

  const files = new Set<string>();
  for (const pattern of allGlobs) {
    const matches = await glob(pattern, {
      cwd: config.root,
      posix: true,
      ignore: config.exclude,
    });
    for (const match of matches) files.add(match);
  }

  const components: ComponentInfo[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(
        path.join(config.root, file),
        "utf-8"
      );
      const comp = await adapter.extractComponent(
        path.join(config.root, file),
        content
      );
      if (comp) {
        comp.filePath = file; // Relative path
        components.push(comp);
      }
    } catch (err) {
      if (verbose) {
        console.log(`  Warning: Failed to parse ${file}: ${(err as Error).message}`);
      }
    }
  }

  return components;
}

function findPageComponents(
  pageFilePath: string,
  allComponents: ComponentInfo[]
): ComponentInfo[] {
  // Normalize path separators for cross-platform matching
  const normalizedPagePath = pageFilePath.replace(/\\/g, "/");

  // Find the page component itself
  const pageComp = allComponents.find((c) => {
    const normalizedCompPath = c.filePath.replace(/\\/g, "/");
    return (
      normalizedCompPath === normalizedPagePath ||
      normalizedCompPath.endsWith(normalizedPagePath) ||
      normalizedPagePath.endsWith(normalizedCompPath)
    );
  });
  if (!pageComp) return [];

  // Find children recursively (up to 2 levels)
  const found = new Set<string>();
  const result: ComponentInfo[] = [];

  function collectChildren(comp: ComponentInfo, depth: number) {
    if (depth > 2) return;
    for (const childName of comp.children) {
      if (found.has(childName)) continue;
      found.add(childName);
      const childComp = allComponents.find((c) => c.name === childName);
      if (childComp) {
        result.push(childComp);
        collectChildren(childComp, depth + 1);
      }
    }
  }

  collectChildren(pageComp, 0);
  return result;
}

function buildComponentGraph(components: ComponentInfo[]): ComponentGraph {
  const nodes = components.map((c) => ({
    id: c.name,
    name: c.name,
    filePath: c.filePath,
    type: c.type,
  }));

  const edges: ComponentGraph["edges"] = [];
  const componentNames = new Set(components.map((c) => c.name));

  for (const comp of components) {
    for (const child of comp.children) {
      if (componentNames.has(child)) {
        edges.push({ from: comp.name, to: child, relation: "uses" });
      }
    }
  }

  return { nodes, edges };
}

function extractLayouts(components: ComponentInfo[]): string[] {
  return components
    .filter((c) => c.type === "layout")
    .map((c) => c.name);
}

function findDependencyVersion(
  pkg: Record<string, unknown> | null,
  frameworkId: string
): string {
  if (!pkg) return "unknown";
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };

  const depMap: Record<string, string> = {
    nextjs: "next",
    react: "react",
    vue: "vue",
    nuxt: "nuxt",
    sveltekit: "@sveltejs/kit",
    svelte: "svelte",
    angular: "@angular/core",
  };

  const depName = depMap[frameworkId];
  return depName ? (deps[depName] || "unknown") : "unknown";
}

function detectLanguage(_root: string): "typescript" | "javascript" | "mixed" {
  return "typescript"; // Simplified; could check for tsconfig.json
}

function detectBuildTool(pkg: Record<string, unknown> | null): string {
  if (!pkg) return "unknown";
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  if ("vite" in deps) return "Vite";
  if ("next" in deps) return "Next.js";
  if ("webpack" in deps) return "Webpack";
  if ("turbopack" in deps) return "Turbopack";
  if ("esbuild" in deps) return "esbuild";
  return "unknown";
}

function detectPackageManager(_root: string): "npm" | "yarn" | "pnpm" | "bun" {
  // Could check lock files
  return "npm";
}

function log(verbose: boolean, message: string) {
  if (verbose) console.log(message);
}
