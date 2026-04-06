import fs from "node:fs/promises";
import path from "node:path";
import type { McpRecommendation } from "./mcp-recommendations.js";

/**
 * Maps MCP server env var names to common project env var names.
 * A project might use SUPABASE_URL but the MCP server expects SUPABASE_ACCESS_TOKEN.
 * This map handles the translation and discovery.
 */
const ENV_DISCOVERY_MAP: Record<string, EnvDiscovery> = {
  // Supabase
  SUPABASE_ACCESS_TOKEN: {
    searchKeys: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"],
    searchFiles: [".env", ".env.local", ".env.development", ".env.development.local"],
  },
  // Stripe
  STRIPE_SECRET_KEY: {
    searchKeys: ["STRIPE_SECRET_KEY", "STRIPE_SK", "STRIPE_API_KEY", "STRIPE_TEST_SECRET_KEY"],
    searchFiles: [".env", ".env.local", ".env.development", ".env.development.local"],
  },
  // GitHub
  GITHUB_PERSONAL_ACCESS_TOKEN: {
    searchKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT"],
    searchFiles: [".env", ".env.local"],
    searchSystemEnv: true,
  },
  // Brave Search
  BRAVE_API_KEY: {
    searchKeys: ["BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY"],
    searchFiles: [".env", ".env.local"],
    searchSystemEnv: true,
  },
  // Sentry
  SENTRY_AUTH_TOKEN: {
    searchKeys: ["SENTRY_AUTH_TOKEN", "SENTRY_TOKEN"],
    searchFiles: [".env", ".env.local"],
    searchSystemEnv: true,
  },
  // Firebase
  GOOGLE_APPLICATION_CREDENTIALS: {
    searchKeys: ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT"],
    searchFiles: [".env", ".env.local"],
    searchSystemEnv: true,
  },
};

interface EnvDiscovery {
  searchKeys: string[];
  searchFiles: string[];
  searchSystemEnv?: boolean;
}

interface ResolvedEnv {
  key: string;
  value: string;
  source: string;
}

/**
 * For each MCP recommendation that needs env vars, try to find them automatically
 */
export async function resolveEnvVars(
  projectRoot: string,
  recommendations: McpRecommendation[]
): Promise<Map<string, Record<string, ResolvedEnv>>> {
  // Parse all potential env files upfront
  const envCache = new Map<string, Record<string, string>>();
  const envFiles = [".env", ".env.local", ".env.development", ".env.development.local"];

  for (const envFile of envFiles) {
    try {
      const content = await fs.readFile(path.join(projectRoot, envFile), "utf-8");
      envCache.set(envFile, parseEnvFile(content));
    } catch {
      // File doesn't exist
    }
  }

  const results = new Map<string, Record<string, ResolvedEnv>>();

  for (const rec of recommendations) {
    if (!rec.env) continue;

    const resolved: Record<string, ResolvedEnv> = {};

    for (const requiredKey of Object.keys(rec.env)) {
      const discovery = ENV_DISCOVERY_MAP[requiredKey];
      if (!discovery) continue;

      let found: ResolvedEnv | null = null;

      // 1. Search in project env files
      for (const envFile of discovery.searchFiles) {
        const envData = envCache.get(envFile);
        if (!envData) continue;

        for (const searchKey of discovery.searchKeys) {
          if (envData[searchKey] && !isPlaceholder(envData[searchKey])) {
            found = { key: requiredKey, value: envData[searchKey], source: envFile };
            break;
          }
        }
        if (found) break;
      }

      // 2. Search in system environment variables
      if (!found && discovery.searchSystemEnv) {
        for (const searchKey of discovery.searchKeys) {
          const val = process.env[searchKey];
          if (val && !isPlaceholder(val)) {
            found = { key: requiredKey, value: val, source: "system env" };
            break;
          }
        }
      }

      if (found) {
        resolved[requiredKey] = found;
      }
    }

    if (Object.keys(resolved).length > 0) {
      results.set(rec.id, resolved);
    }
  }

  return results;
}

/**
 * Apply resolved env vars to MCP server configs in AI settings files
 */
export function applyResolvedEnv(
  mcpServers: Record<string, unknown>,
  resolvedEnvs: Map<string, Record<string, ResolvedEnv>>
): { activated: string[]; pending: string[] } {
  const activated: string[] = [];
  const pending: string[] = [];

  for (const [serverId, serverDef] of Object.entries(mcpServers)) {
    const def = serverDef as Record<string, unknown>;
    if (!def.env) continue;

    const env = def.env as Record<string, string>;
    const resolved = resolvedEnvs.get(serverId);

    let allResolved = true;
    for (const [key, value] of Object.entries(env)) {
      if (value.startsWith("<SET_YOUR_")) {
        if (resolved && resolved[key]) {
          env[key] = resolved[key].value;
        } else {
          allResolved = false;
        }
      }
    }

    if (allResolved && resolved) {
      activated.push(serverId);
    } else if (Object.values(env).some((v) => v.startsWith("<SET_YOUR_"))) {
      pending.push(serverId);
    }
  }

  return { activated, pending };
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("<") ||
    lower.startsWith("your_") ||
    lower.startsWith("set_") ||
    lower === "xxx" ||
    lower === "changeme" ||
    lower === "todo" ||
    lower.includes("placeholder") ||
    lower.includes("example")
  );
}
