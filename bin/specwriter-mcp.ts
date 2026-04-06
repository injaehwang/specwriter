#!/usr/bin/env node

import { startMcpServer } from "../src/mcp/server.js";

const root = process.argv[2] || process.cwd();
startMcpServer(root).catch((err) => {
  process.stderr.write(`MCP server error: ${err}\n`);
  process.exit(1);
});
