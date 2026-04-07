import fs from "node:fs/promises";
import path from "node:path";

export interface McpRecommendation {
  id: string;
  name: string;
  description: string;
  npmPackage: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  reason: string;
  category: "docs" | "search" | "database" | "api" | "devtools" | "testing";
  priority: number;
}

/**
 * Only recommend stable, env-free MCP servers
 */
export async function recommendMcpServers(
  _projectRoot: string
): Promise<McpRecommendation[]> {
  return [
    {
      id: "context7",
      name: "Context7",
      description: "Up-to-date library documentation lookup",
      npmPackage: "@upstash/context7-mcp",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest"],
      reason: "Real-time docs for project dependencies",
      category: "docs",
      priority: 90,
    },
  ];
}

export function buildMcpServerConfigs(
  recommendations: McpRecommendation[]
): Record<string, { command: string; args: string[] }> {
  const configs: Record<string, { command: string; args: string[] }> = {};
  for (const rec of recommendations) {
    if (!rec.env) {
      configs[rec.id] = { command: rec.command, args: rec.args };
    }
  }
  return configs;
}
