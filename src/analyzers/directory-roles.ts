import fs from "node:fs/promises";
import path from "node:path";
import { ComponentInfo } from "../types/component.js";

export interface DirectorySpec {
  path: string;
  role: string;
  description: string;
  fileCount: number;
  componentCount: number;
  keyFiles: string[];
  children: string[];
}

const KNOWN_ROLES: Record<string, string> = {
  // Next.js / App Router
  "app": "Application root — contains pages, layouts, and API routes (Next.js App Router)",
  "app/api": "API route handlers — serverless backend endpoints",
  // Pages Router
  "pages": "Page components — each file maps to a URL route (Pages Router)",
  "pages/api": "API route handlers — serverless backend endpoints",
  // Common
  "src": "Source code root",
  "components": "Shared/reusable UI components",
  "src/components": "Shared/reusable UI components",
  "lib": "Utility functions, helpers, and shared logic",
  "src/lib": "Utility functions, helpers, and shared logic",
  "utils": "Utility functions and helpers",
  "src/utils": "Utility functions and helpers",
  "hooks": "Custom React hooks",
  "src/hooks": "Custom React hooks",
  "types": "TypeScript type definitions and interfaces",
  "src/types": "TypeScript type definitions and interfaces",
  "styles": "Global styles, CSS modules, theme definitions",
  "src/styles": "Global styles, CSS modules, theme definitions",
  "public": "Static assets served directly (images, fonts, favicon)",
  "static": "Static assets served directly",
  "assets": "Static assets (images, icons, fonts)",
  "src/assets": "Static assets (images, icons, fonts)",
  "config": "Application configuration files",
  "src/config": "Application configuration files",
  "constants": "Constant values and enums",
  "src/constants": "Constant values and enums",
  "store": "State management (store definitions, slices, atoms)",
  "src/store": "State management (store definitions, slices, atoms)",
  "stores": "State management (store definitions, slices, atoms)",
  "src/stores": "State management (store definitions, slices, atoms)",
  "context": "React context providers and definitions",
  "src/context": "React context providers and definitions",
  "providers": "Context providers and wrapper components",
  "src/providers": "Context providers and wrapper components",
  "services": "API service layer — data fetching, external service integrations",
  "src/services": "API service layer — data fetching, external service integrations",
  "api": "API client functions and endpoint definitions",
  "src/api": "API client functions and endpoint definitions",
  "middleware": "Request/response middleware",
  "src/middleware": "Request/response middleware",
  "layouts": "Layout components (header, footer, sidebar, page shells)",
  "src/layouts": "Layout components (header, footer, sidebar, page shells)",
  "features": "Feature modules — grouped by business domain",
  "src/features": "Feature modules — grouped by business domain",
  "modules": "Feature modules — grouped by business domain",
  "src/modules": "Feature modules — grouped by business domain",
  "views": "Page-level view components",
  "src/views": "Page-level view components",
  "screens": "Screen-level components (mobile/desktop)",
  "src/screens": "Screen-level components (mobile/desktop)",
  "ui": "Base UI primitives (buttons, inputs, cards)",
  "src/ui": "Base UI primitives (buttons, inputs, cards)",
  "shared": "Shared code between features/modules",
  "src/shared": "Shared code between features/modules",
  "common": "Common utilities shared across the application",
  "src/common": "Common utilities shared across the application",
  "tests": "Test files",
  "__tests__": "Test files",
  "e2e": "End-to-end test files",
  "cypress": "Cypress E2E test files and configuration",
  "prisma": "Prisma ORM — schema, migrations, seed files",
  "db": "Database schema, migrations, and utilities",
  "src/db": "Database schema, migrations, and utilities",
  "scripts": "Build, deploy, and utility scripts",
  "docs": "Documentation files",
  "i18n": "Internationalization — translations and locale files",
  "src/i18n": "Internationalization — translations and locale files",
  "locales": "Locale/translation files",
  "src/locales": "Locale/translation files",
  // Monorepo
  "packages": "Monorepo packages",
  "apps": "Monorepo applications",
  // Server
  "server": "Server-side code (API, SSR, middleware)",
  "src/server": "Server-side code (API, SSR, middleware)",
  "server/api": "Server API route handlers (Nuxt)",
};

/**
 * Analyze all directories in the project and assign roles
 */
export async function analyzeDirectories(
  projectRoot: string,
  components: ComponentInfo[]
): Promise<DirectorySpec[]> {
  const specs: DirectorySpec[] = [];
  const visited = new Set<string>();

  // Group components by directory
  const dirComponents = new Map<string, ComponentInfo[]>();
  for (const comp of components) {
    const dir = comp.filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    if (!dirComponents.has(dir)) dirComponents.set(dir, []);
    dirComponents.get(dir)!.push(comp);
  }

  // Analyze each directory that has components
  for (const [dir, comps] of dirComponents) {
    if (visited.has(dir)) continue;
    visited.add(dir);

    const spec = await analyzeDirectory(projectRoot, dir, comps);
    if (spec) specs.push(spec);
  }

  // Also add known directories that have no components but exist
  for (const knownDir of Object.keys(KNOWN_ROLES)) {
    if (visited.has(knownDir)) continue;
    try {
      await fs.access(path.join(projectRoot, knownDir));
      visited.add(knownDir);

      let fileCount = 0;
      try {
        const entries = await fs.readdir(path.join(projectRoot, knownDir));
        fileCount = entries.filter((e) => !e.startsWith(".")).length;
      } catch {}

      if (fileCount > 0) {
        const entries = await fs.readdir(path.join(projectRoot, knownDir), { withFileTypes: true });
        const children = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const keyFiles = entries
          .filter((e) => e.isFile() && !e.name.startsWith("."))
          .map((e) => e.name)
          .slice(0, 5);

        specs.push({
          path: knownDir,
          role: inferRole(knownDir),
          description: KNOWN_ROLES[knownDir] || inferDescription(knownDir, []),
          fileCount,
          componentCount: 0,
          keyFiles,
          children,
        });
      }
    } catch {
      // Dir doesn't exist
    }
  }

  return specs.sort((a, b) => a.path.localeCompare(b.path));
}

async function analyzeDirectory(
  projectRoot: string,
  dir: string,
  components: ComponentInfo[]
): Promise<DirectorySpec | null> {
  const fullPath = path.join(projectRoot, dir);

  let entries: string[] = [];
  let children: string[] = [];
  try {
    const dirEntries = await fs.readdir(fullPath, { withFileTypes: true });
    entries = dirEntries.filter((e) => e.isFile()).map((e) => e.name);
    children = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }

  const types = new Set(components.map((c) => c.type));
  const keyFiles = entries.filter((f) => !f.startsWith(".")).slice(0, 8);

  return {
    path: dir,
    role: inferRole(dir),
    description: KNOWN_ROLES[dir] || inferDescription(dir, components),
    fileCount: entries.length,
    componentCount: components.length,
    keyFiles,
    children,
  };
}

function inferRole(dir: string): string {
  const parts = dir.replace(/\\/g, "/").toLowerCase().split("/");
  const last = parts[parts.length - 1];

  if (KNOWN_ROLES[dir]) {
    // Extract first word before " —"
    return KNOWN_ROLES[dir].split(" —")[0].split(" — ")[0];
  }

  // Dynamic route segments
  if (last.startsWith("[") && last.endsWith("]")) {
    return "Dynamic route segment";
  }

  // Route groups
  if (last.startsWith("(") && last.endsWith(")")) {
    return "Route group";
  }

  // Underscore-prefixed (Next.js private folders)
  if (last.startsWith("_")) {
    return "Private module";
  }

  return "Module";
}

function inferDescription(dir: string, components: ComponentInfo[]): string {
  if (components.length === 0) return `Directory: ${dir}`;

  const types = new Map<string, number>();
  for (const c of components) {
    types.set(c.type, (types.get(c.type) || 0) + 1);
  }

  const parts: string[] = [];
  for (const [type, count] of types) {
    parts.push(`${count} ${type}${count > 1 ? "s" : ""}`);
  }

  return `Contains ${parts.join(", ")} (${components.map((c) => c.name).slice(0, 5).join(", ")}${components.length > 5 ? ", ..." : ""})`;
}

/**
 * Generate markdown for directory specs
 */
export function directoriesToMarkdown(specs: DirectorySpec[]): string {
  const lines: string[] = [];

  lines.push("# Directory Structure");
  lines.push("");
  lines.push("| Directory | Role | Files | Components |");
  lines.push("|-----------|------|-------|------------|");

  for (const spec of specs) {
    lines.push(
      `| \`${spec.path}/\` | ${spec.description} | ${spec.fileCount} | ${spec.componentCount} |`
    );
  }
  lines.push("");

  // Tree view
  lines.push("## Tree");
  lines.push("");
  lines.push("```");
  for (const spec of specs) {
    const depth = spec.path.split("/").length - 1;
    const indent = "  ".repeat(depth);
    const compNote = spec.componentCount > 0 ? ` (${spec.componentCount} components)` : "";
    lines.push(`${indent}${spec.path.split("/").pop()}/    # ${spec.role}${compNote}`);
  }
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
