import { Command } from "commander";
import path from "node:path";
import { startMcpServer } from "../../mcp/server.js";

export const serveCommand = new Command("serve")
  .description("Start MCP server for AI assistant integration")
  .argument("[path]", "Path to the project root", ".")
  .action(async (targetPath: string) => {
    const root = path.resolve(targetPath);
    await startMcpServer(root);
  });
