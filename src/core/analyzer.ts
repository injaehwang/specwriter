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
import { analyzeDirectories } from "../analyzers/directory-roles.js";

// ─── Progress display ───

function progress(message: string): void {
  process.stdout.write(`\r  ${"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Date.now() % 10 | 0]} ${message}`.padEnd(70));
}

function progressDone(message: string): void {
  process.stdout.write(`\r  ✓ ${message}`.padEnd(70) + "\n");
}

// ─── Main analysis ───

export async function runAnalysis(
  config: AnalysisConfig,
  verbose: boolean
): Promise<void> {
  const startTime = Date.now();
  const debug = (config as any)._debug;

  if (debug) {
    console.log("  [DEBUG] === specwriter debug mode ===");
    console.log(`  [DEBUG] config.root: ${config.root}`);
    console.log(`  [DEBUG] config.output: ${config.output}`);
    console.log(`  [DEBUG] config.framework: ${config.framework}`);
    console.log(`  [DEBUG] config.exclude: ${JSON.stringify(config.exclude)}`);
    console.log(`  [DEBUG] Node version: ${process.version}`);
    console.log(`  [DEBUG] Platform: ${process.platform}`);
    console.log("");
  }

  // 1. Detect framework
  progress("Detecting framework...");
  const detection = await detectFramework(config.root);
  const frameworkId =
    config.framework !== "auto" ? (config.framework as any) : detection.frameworkId;
  progressDone(`Framework: ${frameworkId} (${(detection.confidence * 100).toFixed(0)}%)`);

  if (debug) {
    console.log(`  [DEBUG] Detection evidence:`);
    for (const e of detection.evidence) console.log(`  [DEBUG]   - ${e}`);
    console.log("");
  }

  const adapter = getAdapter(frameworkId);

  // 2. Detect monorepo
  progress("Checking project structure...");
  const monorepo = await detectMonorepo(config.root);
  const [structure, techStack, pkg] = await Promise.all([
    adapter.detectStructure(config.root),
    adapter.detectTechStack(config.root),
    readPackageJson(config.root),
  ]);
  if (monorepo) {
    progressDone(`Monorepo: ${monorepo.type} (${monorepo.packages.length} packages)`);
  } else {
    progressDone(`Project: ${(pkg?.name as string) || path.basename(config.root)}`);
  }

  const frameworkInfo: FrameworkInfo = {
    id: frameworkId,
    name: adapter.name,
    version: findDependencyVersion(pkg, frameworkId),
    confidence: detection.confidence,
    routingStrategy: ["nextjs", "nuxt", "sveltekit"].includes(frameworkId)
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
      language: (techStack.language as any) || "typescript",
      styling: techStack.styling || [],
      stateManagement: techStack.stateManagement || [],
      testing: techStack.testing || [],
      buildTool: detectBuildTool(pkg),
      packageManager: await detectPackageManager(config.root),
      linting: techStack.linting || [],
      otherLibraries: [],
    },
    structure,
  };

  // 3. Discover ALL source files
  progress("Scanning files...");
  const allFiles = await discoverSourceFiles(config, adapter);
  progressDone(`Found ${allFiles.length} source files`);

  // 4. Extract ALL components from ALL files
  progress(`Extracting components (0/${allFiles.length})...`);
  const components = await extractAllComponents(config, adapter, allFiles, (done, total) => {
    progress(`Extracting components (${done}/${total})...`);
  });
  progressDone(`Extracted ${components.length} components from ${allFiles.length} files`);

  // 5. Extract routes
  progress("Extracting routes...");
  const routes = await adapter.extractRoutes(config.root, config);
  progressDone(`Found ${routes.length} routes`);

  // 6. Detect conventions (ACTUALLY analyze, not hardcode)
  progress("Analyzing conventions...");
  const conventions = await detectRealConventions(config.root, components);
  progressDone("Conventions analyzed");

  // 7. Analyze tooling
  progress("Analyzing development tooling...");
  const [tooling, mcpRecommendations] = await Promise.all([
    analyzeTooling(config.root),
    recommendMcpServers(config.root),
  ]);
  progressDone(`Tooling analyzed, ${mcpRecommendations.length} MCP servers recommended`);

  // 8. Build page tree — PROPERLY match pages to components
  progress("Building page tree...");
  const pages: PageInfo[] = routes
    .filter((r) => !r.isApiRoute)
    .map((route) => {
      const pageComponents = findPageComponents(route.filePath, components, config.root);
      const componentRefs = assignComponentRoles(pageComponents);

      const wireframe = config.wireframes && componentRefs.length > 0
        ? buildWireframeFromComponents(
            componentRefs.map((c) => ({ name: c.name, role: c.role }))
          )
        : null;

      return {
        route,
        components: componentRefs,
        wireframe,
        description: "",
        dataFetching: detectDataFetching(route.filePath, components),
      };
    });

  const pageTree: PageTree = {
    pages,
    routes,
    layouts: components.filter((c) => c.type === "layout").map((c) => c.name),
  };
  progressDone(`Built ${pages.length} page specs`);

  // 9. Analyze directory structure
  progress("Analyzing directory roles...");
  const directories = await analyzeDirectories(config.root, components);
  progressDone(`Mapped ${directories.length} directories`);

  // 10. Build component graph
  const componentGraph = buildComponentGraph(components);

  // 10. Build spec output
  const spec: SpecOutput = {
    manifest: {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      toolVersion: "0.1.0",
      frameworkDetected: frameworkId,
      analyzedFiles: allFiles.length,
      duration: Date.now() - startTime,
    },
    project: projectInfo,
    rules: {
      naming: conventions.naming || {
        components: "unknown", files: "unknown", functions: "unknown",
        variables: "unknown", cssClasses: "unknown", directories: "unknown",
      },
      patterns: conventions.patterns || [],
      fileOrganization: conventions.fileOrganization || [],
      importConventions: conventions.importConventions || [],
    },
    pageTree,
    components,
    componentGraph,
    directories,
    tooling,
    mcpRecommendations,
  };

  // 11. Generate output
  progress("Writing specs...");
  await generateOutput(spec, config);
  progressDone("Specs written");

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Done! ${components.length} components, ${routes.length} routes in ${duration}s`);
  console.log(`  Output: ${path.resolve(config.root, config.output)}/\n`);
}

// ─── File discovery — comprehensive ───

async function discoverSourceFiles(
  config: AnalysisConfig,
  _adapter: ReturnType<typeof getAdapter>
): Promise<string[]> {
  const debug = (config as any)._debug;
  const files = new Set<string>();

  // Scan EVERYTHING — exclude only known non-source directories
  const scanAll = [
    "**/*.{tsx,jsx,ts,js,mjs,cjs,vue,svelte}",
  ];

  const defaultExclude = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/.svelte-kit/**",
    "**/.output/**",
    "**/.vercel/**",
    "**/.cache/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/__tests__/**",
    "**/__mocks__/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.stories.*",
    "**/stories/**",
    "**/*.d.ts",
    "**/*.min.js",
    "**/*.bundle.js",
    "**/public/**/*.js",
    "**/static/**/*.js",
  ];
  const exclude = [...defaultExclude, ...config.exclude];

  if (debug) {
    console.log("\n  [DEBUG] === File Discovery ===");
    console.log(`  [DEBUG] cwd: ${config.root}`);
    console.log(`  [DEBUG] pattern: ${scanAll[0]}`);
    console.log(`  [DEBUG] exclude count: ${exclude.length}`);
  }

  for (const pattern of scanAll) {
    try {
      const matches = await glob(pattern, {
        cwd: config.root,
        posix: true,
        ignore: exclude,
      });
      if (debug) {
        console.log(`  [DEBUG] glob returned ${matches.length} files`);
        if (matches.length <= 20) {
          for (const m of matches) console.log(`  [DEBUG]   ${m}`);
        } else {
          for (const m of matches.slice(0, 10)) console.log(`  [DEBUG]   ${m}`);
          console.log(`  [DEBUG]   ... and ${matches.length - 10} more`);
        }
      }
      for (const m of matches) files.add(m);
    } catch (err) {
      if (debug) console.log(`  [DEBUG] glob error: ${err}`);
    }
  }

  if (debug && files.size === 0) {
    // Emergency: try listing directory contents
    console.log("  [DEBUG] === No files found! Listing root directory ===");
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(config.root);
      console.log(`  [DEBUG] Root contains ${entries.length} entries:`);
      for (const e of entries.slice(0, 30)) console.log(`  [DEBUG]   ${e}`);
    } catch (err) {
      console.log(`  [DEBUG] Cannot read directory: ${err}`);
    }
  }

  return Array.from(files).sort();
}

// ─── Component extraction — ALL per file ───

async function extractAllComponents(
  config: AnalysisConfig,
  adapter: ReturnType<typeof getAdapter>,
  files: string[],
  onProgress: (done: number, total: number) => void
): Promise<ComponentInfo[]> {
  const debug = (config as any)._debug;
  const components: ComponentInfo[] = [];
  const { extractAllComponentsFromFile } = await import("../parsers/typescript.js");

  let done = 0;
  let skipped = 0;
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(config.root, file), "utf-8");

      let fileComponents: ComponentInfo[];

      if (file.endsWith(".vue")) {
        const { extractVueComponent } = await import("../parsers/vue-sfc.js");
        const comp = extractVueComponent(path.join(config.root, file), content);
        fileComponents = comp ? [comp] : [];
      } else {
        fileComponents = extractAllComponentsFromFile(path.join(config.root, file), content);
      }

      if (debug && fileComponents.length > 0) {
        console.log(`  [DEBUG] ${file} → ${fileComponents.length} components: ${fileComponents.map(c => c.name).join(", ")}`);
      }
      if (debug && fileComponents.length === 0) {
        skipped++;
      }

      for (const comp of fileComponents) {
        comp.filePath = file; // Relative path
        components.push(comp);
      }
    } catch (err) {
      if (debug) {
        console.log(`  [DEBUG] PARSE ERROR: ${file} → ${(err as Error).message}`);
      }
    }

    done++;
    if (done % 20 === 0 || done === files.length) {
      onProgress(done, files.length);
    }
  }

  if (debug) {
    console.log(`  [DEBUG] Total: ${components.length} components, ${skipped} files had no components`);
    console.log("");
  }

  return components;
}

// ─── Page-component matching — trace imports ───

function findPageComponents(
  pageFilePath: string,
  allComponents: ComponentInfo[],
  projectRoot: string
): ComponentInfo[] {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const pageNorm = norm(pageFilePath);

  // 1. Find the page component itself
  const pageComp = allComponents.find((c) => {
    const compNorm = norm(c.filePath);
    return compNorm === pageNorm || compNorm.endsWith(pageNorm) || pageNorm.endsWith(compNorm);
  });

  if (!pageComp) return [];

  // 2. Collect all children recursively
  const result: ComponentInfo[] = [];
  const visited = new Set<string>();
  const componentMap = new Map<string, ComponentInfo>();
  for (const c of allComponents) {
    componentMap.set(c.name, c);
    // Also map by lowercase for fuzzy matching
    componentMap.set(c.name.toLowerCase(), c);
  }

  function collect(comp: ComponentInfo, depth: number) {
    if (depth > 4) return;
    for (const childName of comp.children) {
      if (visited.has(childName)) continue;
      visited.add(childName);

      const childComp = componentMap.get(childName) || componentMap.get(childName.toLowerCase());
      if (childComp) {
        result.push(childComp);
        collect(childComp, depth + 1);
      }
    }

    // Also check imports for component references
    for (const imp of comp.imports) {
      if (imp.isType) continue;
      for (const spec of imp.specifiers) {
        if (/^[A-Z]/.test(spec) && !visited.has(spec)) {
          visited.add(spec);
          const imported = componentMap.get(spec) || componentMap.get(spec.toLowerCase());
          if (imported) {
            result.push(imported);
            collect(imported, depth + 1);
          }
        }
      }
    }
  }

  collect(pageComp, 0);

  // Also include layout components
  const layoutComp = allComponents.find((c) => {
    const n = norm(c.filePath);
    // Find layout.tsx in same directory tree
    const pageDir = pageNorm.split("/").slice(0, -1).join("/");
    return c.type === "layout" && n.startsWith(pageDir.split("/").slice(0, -1).join("/"));
  });
  if (layoutComp && !visited.has(layoutComp.name)) {
    result.push(layoutComp);
    collect(layoutComp, 0);
  }

  return result;
}

// ─── Real convention detection ───

async function detectRealConventions(
  projectRoot: string,
  components: ComponentInfo[]
): Promise<any> {
  const naming: Record<string, Record<string, number>> = {
    components: {}, files: {}, functions: {}, variables: {}, directories: {},
  };

  for (const comp of components) {
    // Component naming
    const compCase = detectCase(comp.name);
    naming.components[compCase] = (naming.components[compCase] || 0) + 1;

    // File naming
    const fileName = comp.filePath.replace(/\\/g, "/").split("/").pop() || "";
    const fileBase = fileName.replace(/\.[^.]+$/, "");
    const fileCase = detectCase(fileBase);
    naming.files[fileCase] = (naming.files[fileCase] || 0) + 1;

    // Directory naming
    const dirs = comp.filePath.replace(/\\/g, "/").split("/").slice(0, -1);
    for (const dir of dirs) {
      if (dir === "src" || dir === "app" || dir === "pages") continue;
      const dirCase = detectCase(dir);
      naming.directories[dirCase] = (naming.directories[dirCase] || 0) + 1;
    }
  }

  const mostCommon = (counts: Record<string, number>): string => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || "unknown";
  };

  // Detect import patterns
  const importPatterns: { pattern: string; description: string; example: string }[] = [];
  const aliasUsage = new Map<string, number>();
  for (const comp of components) {
    for (const imp of comp.imports) {
      if (imp.source.startsWith("@/")) {
        aliasUsage.set("@/", (aliasUsage.get("@/") || 0) + 1);
      } else if (imp.source.startsWith("~/")) {
        aliasUsage.set("~/", (aliasUsage.get("~/") || 0) + 1);
      }
    }
  }
  for (const [alias, count] of aliasUsage) {
    if (count > 2) {
      importPatterns.push({
        pattern: `${alias}*`,
        description: `Path alias used in ${count} imports`,
        example: `import { X } from "${alias}components/X"`,
      });
    }
  }

  // Detect file organization patterns
  const fileOrg: { pattern: string; purpose: string; examples: string[] }[] = [];
  const dirPurpose = new Map<string, string[]>();
  for (const comp of components) {
    const parts = comp.filePath.replace(/\\/g, "/").split("/");
    if (parts.length >= 2) {
      const dir = parts.slice(0, -1).join("/");
      if (!dirPurpose.has(dir)) dirPurpose.set(dir, []);
      dirPurpose.get(dir)!.push(comp.name);
    }
  }
  for (const [dir, comps] of dirPurpose) {
    if (comps.length >= 2) {
      fileOrg.push({
        pattern: `${dir}/*`,
        purpose: `Contains ${comps.length} components`,
        examples: comps.slice(0, 3),
      });
    }
  }

  return {
    naming: {
      components: mostCommon(naming.components),
      files: mostCommon(naming.files),
      functions: "camelCase",
      variables: "camelCase",
      cssClasses: "unknown",
      directories: mostCommon(naming.directories),
    },
    patterns: [],
    fileOrganization: fileOrg.slice(0, 20),
    importConventions: importPatterns,
  };
}

function detectCase(name: string): string {
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name) && /[a-z]/.test(name)) return "PascalCase";
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return "camelCase";
  if (/^[a-z]+(-[a-z]+)+$/.test(name)) return "kebab-case";
  if (/^[a-z]+(_[a-z]+)+$/.test(name)) return "snake_case";
  if (/^[A-Z]+(_[A-Z]+)*$/.test(name)) return "UPPER_SNAKE_CASE";
  return "mixed";
}

// ─── Data fetching detection ───

function detectDataFetching(
  pageFilePath: string,
  allComponents: ComponentInfo[]
): { method: string; endpoint: string | null; type: "ssr" | "ssg" | "csr" | "isr" | "streaming" }[] {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const pageComp = allComponents.find((c) => norm(c.filePath) === norm(pageFilePath));
  if (!pageComp) return [];

  type FetchType = "ssr" | "ssg" | "csr" | "isr" | "streaming";
  const results: { method: string; endpoint: string | null; type: FetchType }[] = [];
  const imports = pageComp.imports.map((i) => i.specifiers).flat();

  // Server-side indicators
  if (imports.includes("getServerSideProps")) results.push({ method: "getServerSideProps", endpoint: null, type: "ssr" });
  if (imports.includes("getStaticProps")) results.push({ method: "getStaticProps", endpoint: null, type: "ssg" });

  // Async server components (Next.js App Router)
  if (pageComp.isServerComponent) {
    results.push({ method: "Server Component (async)", endpoint: null, type: "ssr" });
  }

  // Client-side data fetching hooks
  for (const imp of pageComp.imports) {
    if (imp.source.includes("@tanstack/react-query") || imp.source.includes("react-query")) {
      results.push({ method: "useQuery (TanStack)", endpoint: null, type: "csr" });
    }
    if (imp.source === "swr") {
      results.push({ method: "useSWR", endpoint: null, type: "csr" });
    }
  }

  return results;
}

// ─── Component graph ───

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
      if (componentNames.has(child) && child !== comp.name) {
        edges.push({ from: comp.name, to: child, relation: "uses" });
      }
    }
    // Also trace imports
    for (const imp of comp.imports) {
      if (imp.isType) continue;
      for (const spec of imp.specifiers) {
        if (componentNames.has(spec) && spec !== comp.name && /^[A-Z]/.test(spec)) {
          // Avoid duplicates
          if (!edges.some((e) => e.from === comp.name && e.to === spec)) {
            edges.push({ from: comp.name, to: spec, relation: "uses" });
          }
        }
      }
    }
  }

  return { nodes, edges };
}

// ─── Monorepo detection ───

interface MonorepoInfo {
  type: "pnpm" | "yarn" | "npm" | "turborepo" | "nx" | "lerna";
  packages: string[];
}

async function detectMonorepo(projectRoot: string): Promise<MonorepoInfo | null> {
  // Check pnpm-workspace.yaml
  try {
    const content = await fs.readFile(path.join(projectRoot, "pnpm-workspace.yaml"), "utf-8");
    const match = content.match(/packages:\s*\n([\s\S]*?)(?:\n\S|$)/);
    if (match) {
      const packages = match[1].split("\n")
        .map((l) => l.trim().replace(/^-\s*['"]?/, "").replace(/['"]?\s*$/, ""))
        .filter(Boolean);
      return { type: "pnpm", packages };
    }
  } catch {}

  // Check package.json workspaces
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf-8"));
    if (pkg.workspaces) {
      const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || [];
      return { type: "npm", packages: workspaces };
    }
  } catch {}

  // Check turbo.json
  try {
    await fs.access(path.join(projectRoot, "turbo.json"));
    const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf-8"));
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || [];
    return { type: "turborepo", packages: workspaces };
  } catch {}

  // Check nx.json
  try {
    await fs.access(path.join(projectRoot, "nx.json"));
    return { type: "nx", packages: ["packages/*", "apps/*"] };
  } catch {}

  // Check lerna.json
  try {
    const content = await fs.readFile(path.join(projectRoot, "lerna.json"), "utf-8");
    const lerna = JSON.parse(content);
    return { type: "lerna", packages: lerna.packages || ["packages/*"] };
  } catch {}

  return null;
}

// ─── Helpers ───

function findDependencyVersion(
  pkg: Record<string, unknown> | null,
  frameworkId: string
): string {
  if (!pkg) return "unknown";
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  const depMap: Record<string, string> = {
    nextjs: "next", react: "react", vue: "vue", nuxt: "nuxt",
    sveltekit: "@sveltejs/kit", svelte: "svelte", angular: "@angular/core",
  };
  const depName = depMap[frameworkId];
  return depName ? (deps[depName] || "unknown") : "unknown";
}

function detectBuildTool(pkg: Record<string, unknown> | null): string {
  if (!pkg) return "unknown";
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  if ("next" in deps) return "Next.js";
  if ("vite" in deps) return "Vite";
  if ("webpack" in deps) return "Webpack";
  if ("turbopack" in deps) return "Turbopack";
  if ("esbuild" in deps) return "esbuild";
  return "unknown";
}

async function detectPackageManager(root: string): Promise<"npm" | "yarn" | "pnpm" | "bun"> {
  try { await fs.access(path.join(root, "pnpm-lock.yaml")); return "pnpm"; } catch {}
  try { await fs.access(path.join(root, "yarn.lock")); return "yarn"; } catch {}
  try { await fs.access(path.join(root, "bun.lockb")); return "bun"; } catch {}
  return "npm";
}
