import fs from "node:fs/promises";
import path from "node:path";

/**
 * Recommended MCP server that can be auto-registered
 */
export interface McpRecommendation {
  id: string;
  name: string;
  description: string;
  /** npm package name for the MCP server */
  npmPackage: string;
  /** Command to run the MCP server */
  command: string;
  args: string[];
  /** env vars needed (key → description) */
  env?: Record<string, string>;
  /** Why this is recommended for this project */
  reason: string;
  /** Category */
  category: "docs" | "search" | "database" | "api" | "devtools" | "testing";
  /** Priority: higher = more relevant */
  priority: number;
}

interface DetectionContext {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  hasFile: (relativePath: string) => Promise<boolean>;
  projectRoot: string;
}

/**
 * Analyze a project and recommend relevant MCP servers
 */
export async function recommendMcpServers(
  projectRoot: string
): Promise<McpRecommendation[]> {
  let pkg: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(path.join(projectRoot, "package.json"), "utf-8");
    pkg = JSON.parse(content);
  } catch {
    return [];
  }

  const deps = (pkg.dependencies as Record<string, string>) || {};
  const devDeps = (pkg.devDependencies as Record<string, string>) || {};
  const allDeps = { ...deps, ...devDeps };

  const ctx: DetectionContext = {
    dependencies: deps,
    devDependencies: devDeps,
    hasFile: async (rel) => {
      try {
        await fs.access(path.join(projectRoot, rel));
        return true;
      } catch {
        return false;
      }
    },
    projectRoot,
  };

  const recommendations: McpRecommendation[] = [];

  // ─── Documentation / Library lookup ───

  // Context7 — always useful for any JS/TS project
  recommendations.push({
    id: "context7",
    name: "Context7",
    description: "Pulls up-to-date documentation for libraries directly into AI context",
    npmPackage: "@upstash/context7-mcp",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    reason: "Provides real-time library documentation lookup for all project dependencies",
    category: "docs",
    priority: 90,
  });

  // ─── Search ───

  // Brave Search
  recommendations.push({
    id: "brave-search",
    name: "Brave Search",
    description: "Web search tool for AI to look up documentation, errors, and solutions",
    npmPackage: "@anthropic/mcp-server-brave-search",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-brave-search"],
    env: { BRAVE_API_KEY: "Brave Search API key (free tier available)" },
    reason: "Enables AI to search the web for error solutions and documentation",
    category: "search",
    priority: 70,
  });

  // ─── Database ───

  if ("@supabase/supabase-js" in allDeps || "@supabase/ssr" in allDeps) {
    recommendations.push({
      id: "supabase",
      name: "Supabase",
      description: "Query and manage Supabase database, auth, and storage directly",
      npmPackage: "@supabase/mcp-server-supabase",
      command: "npx",
      args: ["-y", "@supabase/mcp-server-supabase"],
      env: { SUPABASE_ACCESS_TOKEN: "Supabase personal access token" },
      reason: `Project uses @supabase/supabase-js — direct database access for schema inspection`,
      category: "database",
      priority: 85,
    });
  }

  if ("@prisma/client" in allDeps || "prisma" in devDeps) {
    recommendations.push({
      id: "prisma",
      name: "Prisma",
      description: "Inspect Prisma schema, run migrations, and query the database",
      npmPackage: "@anthropic/mcp-server-prisma",
      command: "npx",
      args: ["-y", "@anthropic/mcp-server-prisma"],
      reason: "Project uses Prisma — enables schema inspection and migration management",
      category: "database",
      priority: 85,
    });
  }

  if ("pg" in allDeps || "postgres" in allDeps || "@neondatabase/serverless" in allDeps) {
    recommendations.push({
      id: "postgres",
      name: "PostgreSQL",
      description: "Direct PostgreSQL database access for schema inspection and queries",
      npmPackage: "@anthropic/mcp-server-postgres",
      command: "npx",
      args: ["-y", "@anthropic/mcp-server-postgres"],
      env: { DATABASE_URL: "PostgreSQL connection string" },
      reason: "Project uses PostgreSQL client — direct DB schema and query access",
      category: "database",
      priority: 80,
    });
  }

  // ─── API / Backend ───

  if ("firebase" in allDeps || "firebase-admin" in allDeps || "@firebase/app" in allDeps) {
    recommendations.push({
      id: "firebase",
      name: "Firebase",
      description: "Manage Firebase services: Firestore, Auth, Storage, Functions",
      npmPackage: "@anthropic/mcp-server-firebase",
      command: "npx",
      args: ["-y", "@anthropic/mcp-server-firebase"],
      reason: "Project uses Firebase — direct access to Firestore, Auth configuration",
      category: "api",
      priority: 80,
    });
  }

  if ("stripe" in allDeps || "@stripe/stripe-js" in allDeps) {
    recommendations.push({
      id: "stripe",
      name: "Stripe",
      description: "Inspect Stripe API resources: products, prices, subscriptions",
      npmPackage: "@stripe/mcp-server",
      command: "npx",
      args: ["-y", "@stripe/mcp-server"],
      env: { STRIPE_SECRET_KEY: "Stripe secret key" },
      reason: "Project uses Stripe — enables payment configuration inspection",
      category: "api",
      priority: 75,
    });
  }

  // ─── DevTools ───

  if (await ctx.hasFile(".github")) {
    recommendations.push({
      id: "github",
      name: "GitHub",
      description: "Manage issues, PRs, releases, and repository settings",
      npmPackage: "@modelcontextprotocol/server-github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "GitHub personal access token" },
      reason: "Project is on GitHub — enables PR, issue, and release management",
      category: "devtools",
      priority: 75,
    });
  }

  if (JSON.stringify(allDeps).toLowerCase().includes("sentry") || "@sentry/nextjs" in allDeps || "@sentry/react" in allDeps) {
    recommendations.push({
      id: "sentry",
      name: "Sentry",
      description: "Query error tracking, performance data, and release health",
      npmPackage: "@sentry/mcp-server",
      command: "npx",
      args: ["-y", "@sentry/mcp-server"],
      env: { SENTRY_AUTH_TOKEN: "Sentry auth token" },
      reason: "Project uses Sentry — enables error investigation during development",
      category: "devtools",
      priority: 70,
    });
  }

  // ─── Testing ───

  if ("playwright" in devDeps || "@playwright/test" in devDeps) {
    recommendations.push({
      id: "playwright",
      name: "Playwright",
      description: "Run and manage Playwright browser tests",
      npmPackage: "@anthropic/mcp-server-playwright",
      command: "npx",
      args: ["-y", "@anthropic/mcp-server-playwright"],
      reason: "Project uses Playwright — enables AI to run and debug E2E tests",
      category: "testing",
      priority: 70,
    });
  }

  // Sort by priority (highest first)
  return recommendations.sort((a, b) => b.priority - a.priority);
}

/**
 * Generate MCP server configs for recommended tools
 */
export function buildMcpServerConfigs(
  recommendations: McpRecommendation[]
): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  const configs: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  for (const rec of recommendations) {
    const config: { command: string; args: string[]; env?: Record<string, string> } = {
      command: rec.command,
      args: rec.args,
    };
    if (rec.env) {
      config.env = {};
      for (const [key] of Object.entries(rec.env)) {
        config.env[key] = `<YOUR_${key}>`;
      }
    }
    configs[rec.id] = config;
  }

  return configs;
}
