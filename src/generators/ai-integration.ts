import fs from "node:fs/promises";
import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { toolingToMarkdown, toolingToAiInstructions } from "../analyzers/tooling.js";
import { buildMcpServerConfigs } from "../analyzers/mcp-recommendations.js";
import { resolveEnvVars, applyResolvedEnv } from "../analyzers/env-resolver.js";

// ─── Marker for detecting specwriter-injected content ───
const MARKER_START = "<!-- specwriter:start -->";
const MARKER_END = "<!-- specwriter:end -->";

// ─── All known AI assistant config locations ───
interface AiConfigTarget {
  id: string;
  name: string;
  /** Path relative to project root. null = skip detection, always generate */
  detectPath: string | null;
  /** Where to write/inject the reference */
  injectPath: string;
  /** Format of the injection */
  format: "markdown" | "mdc" | "yaml" | "json" | "text";
  /** Whether to create the file if it doesn't exist, or only inject into existing */
  createIfMissing: boolean;
  /** Whether this needs a directory to be created */
  needsDir?: string;
}

const AI_TARGETS: AiConfigTarget[] = [
  // Claude Code
  {
    id: "claude",
    name: "Claude Code",
    detectPath: "CLAUDE.md",
    injectPath: "CLAUDE.md",
    format: "markdown",
    createIfMissing: false,
  },
  // Cursor (modern)
  {
    id: "cursor",
    name: "Cursor",
    detectPath: ".cursor",
    injectPath: ".cursor/rules/specwriter.mdc",
    format: "mdc",
    createIfMissing: false,
    needsDir: ".cursor/rules",
  },
  // Cursor (legacy)
  {
    id: "cursor-legacy",
    name: "Cursor (legacy)",
    detectPath: ".cursorrules",
    injectPath: ".cursorrules",
    format: "text",
    createIfMissing: false,
  },
  // GitHub Copilot
  {
    id: "copilot",
    name: "GitHub Copilot",
    detectPath: ".github",
    injectPath: ".github/copilot-instructions.md",
    format: "markdown",
    createIfMissing: false,
  },
  // Gemini CLI
  {
    id: "gemini",
    name: "Gemini",
    detectPath: ".gemini",
    injectPath: ".gemini/GEMINI.md",
    format: "markdown",
    createIfMissing: false,
  },
  // Windsurf (modern)
  {
    id: "windsurf",
    name: "Windsurf",
    detectPath: ".windsurf",
    injectPath: ".windsurf/rules/specwriter.md",
    format: "markdown",
    createIfMissing: false,
    needsDir: ".windsurf/rules",
  },
  // Windsurf (legacy)
  {
    id: "windsurf-legacy",
    name: "Windsurf (legacy)",
    detectPath: ".windsurfrules",
    injectPath: ".windsurfrules",
    format: "text",
    createIfMissing: false,
  },
  // Cline
  {
    id: "cline",
    name: "Cline",
    detectPath: ".clinerules",
    injectPath: ".clinerules",
    format: "text",
    createIfMissing: false,
  },
  // JetBrains AI Assistant
  {
    id: "jetbrains",
    name: "JetBrains AI",
    detectPath: ".aiassistant",
    injectPath: ".aiassistant/rules/specwriter.md",
    format: "markdown",
    createIfMissing: false,
    needsDir: ".aiassistant/rules",
  },
  // Continue.dev
  {
    id: "continue",
    name: "Continue.dev",
    detectPath: ".continuerc.json",
    injectPath: ".continuerc.json",
    format: "json",
    createIfMissing: false,
  },
  // Aider
  {
    id: "aider",
    name: "Aider",
    detectPath: ".aider.conf.yml",
    injectPath: ".aider.conf.yml",
    format: "yaml",
    createIfMissing: false,
  },
  // Tabnine
  {
    id: "tabnine",
    name: "Tabnine",
    detectPath: ".tabnine",
    injectPath: ".tabnine/guidelines/specwriter.md",
    format: "markdown",
    createIfMissing: false,
    needsDir: ".tabnine/guidelines",
  },
  // OpenAI Codex / Generic
  {
    id: "codex",
    name: "OpenAI Codex",
    detectPath: "AGENTS.md",
    injectPath: "AGENTS.md",
    format: "markdown",
    createIfMissing: false,
  },
];

// ─── Main entry ───

export async function generateAiIntegration(
  spec: SpecOutput,
  config: AnalysisConfig
): Promise<void> {
  const projectRoot = config.root;
  const outputDir = path.resolve(projectRoot, config.output);

  // 1. Always generate the universal context file inside .specwriter/
  await writeUniversalContext(spec, outputDir);

  // 2. Detect existing AI configs and inject references
  const detected = await detectAiConfigs(projectRoot);
  const injected: string[] = [];

  for (const target of detected) {
    try {
      await injectReference(spec, projectRoot, target);
      injected.push(target.name);
    } catch {
      // Silently skip on error
    }
  }

  // 3. Inject MCP server config into AI tools that support it
  const mcpInjected = await injectMcpConfigs(projectRoot, spec);

  // 4. Write recommended MCP config as a reference file
  if (spec.mcpRecommendations.length > 0) {
    const recConfigs = buildMcpServerConfigs(spec.mcpRecommendations);
    const combined: Record<string, unknown> = {
      specwriter: { command: "npx", args: ["-y", "specwriter", "serve", projectRoot] },
      ...recConfigs,
    };
    await fs.writeFile(
      path.join(outputDir, "mcp-servers.json"),
      JSON.stringify({ mcpServers: combined }, null, 2) + "\n"
    );
  }

  if (injected.length > 0) {
    console.log(`  AI integrations: ${injected.join(", ")}`);
  }
  if (mcpInjected.length > 0) {
    console.log(`  MCP registered:  ${mcpInjected.join(", ")}`);
  }
}

// ─── Detection ───

async function detectAiConfigs(projectRoot: string): Promise<AiConfigTarget[]> {
  const detected: AiConfigTarget[] = [];

  for (const target of AI_TARGETS) {
    if (!target.detectPath) {
      detected.push(target);
      continue;
    }

    const fullPath = path.join(projectRoot, target.detectPath);
    try {
      await fs.access(fullPath);
      detected.push(target);
    } catch {
      // Not found
    }
  }

  return detected;
}

// ─── Universal context (inside .specwriter/) ───

async function writeUniversalContext(
  spec: SpecOutput,
  outputDir: string
): Promise<void> {
  const content = buildFullContext(spec);
  await fs.writeFile(path.join(outputDir, "AI_CONTEXT.md"), content);
}

function buildFullContext(spec: SpecOutput): string {
  const { project, rules, pageTree, components } = spec;
  const lines: string[] = [];

  lines.push(`# ${project.name} — Project Specification`);
  lines.push("");
  lines.push("> Auto-generated by specwriter. This file is designed to be read by AI coding assistants.");
  lines.push("> For the most detailed specifications, refer to the individual files in this directory.");
  lines.push("");

  // Tech Stack
  lines.push("## Tech Stack");
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Framework | ${project.framework.name} ${project.framework.version} |`);
  lines.push(`| Language | ${project.techStack.language} |`);
  lines.push(`| Build Tool | ${project.techStack.buildTool} |`);
  lines.push(`| Package Manager | ${project.techStack.packageManager} |`);
  if (project.techStack.styling.length > 0) {
    lines.push(`| Styling | ${project.techStack.styling.join(", ")} |`);
  }
  if (project.techStack.stateManagement.length > 0) {
    lines.push(`| State Management | ${project.techStack.stateManagement.join(", ")} |`);
  }
  if (project.techStack.testing.length > 0) {
    lines.push(`| Testing | ${project.techStack.testing.join(", ")} |`);
  }
  if (project.techStack.linting.length > 0) {
    lines.push(`| Linting | ${project.techStack.linting.join(", ")} |`);
  }
  lines.push("");

  // Architecture
  lines.push("## Architecture");
  lines.push("");
  lines.push(`- Routing: ${project.framework.routingStrategy}`);
  if (project.structure.pagesDir) lines.push(`- Pages: \`${project.structure.pagesDir}/\``);
  if (project.structure.componentsDir) lines.push(`- Components: \`${project.structure.componentsDir}/\``);
  if (project.structure.apiDir) lines.push(`- API: \`${project.structure.apiDir}/\``);
  lines.push("");

  // Directory Structure
  if (spec.directories.length > 0) {
    lines.push("## Directory Structure");
    lines.push("");
    for (const dir of spec.directories) {
      const compNote = dir.componentCount > 0 ? ` — ${dir.componentCount} components` : "";
      lines.push(`- \`${dir.path}/\` — ${dir.description}${compNote}`);
    }
    lines.push("");
  }

  // Coding Conventions
  lines.push("## Coding Conventions");
  lines.push("");
  lines.push(`- Components: ${rules.naming.components}`);
  lines.push(`- Files: ${rules.naming.files}`);
  lines.push(`- Functions: ${rules.naming.functions}`);
  lines.push(`- Variables: ${rules.naming.variables}`);
  lines.push("");

  // Route Map
  const pageRoutes = pageTree.routes.filter((r) => !r.isApiRoute);
  const apiRoutes = pageTree.routes.filter((r) => r.isApiRoute);

  if (pageRoutes.length > 0) {
    lines.push("## Pages");
    lines.push("");
    for (const route of pageRoutes) {
      const dynamic = route.isDynamic ? ` [${route.params.join(", ")}]` : "";
      lines.push(`- \`${route.path}\`${dynamic} → \`${route.filePath}\``);
    }
    lines.push("");
  }

  if (apiRoutes.length > 0) {
    lines.push("## API Routes");
    lines.push("");
    for (const route of apiRoutes) {
      lines.push(`- \`${route.path}\` → \`${route.filePath}\``);
    }
    lines.push("");
  }

  // Key Components
  const keyComponents = components
    .filter((c) => c.type !== "utility" && c.type !== "hook")
    .slice(0, 50);

  if (keyComponents.length > 0) {
    lines.push("## Components");
    lines.push("");
    for (const comp of keyComponents) {
      const propsStr = comp.props.length > 0
        ? ` — props: ${comp.props.map((p) => `${p.name}: ${p.type}`).join(", ")}`
        : "";
      lines.push(`- **${comp.name}** \`${comp.filePath}\` [${comp.type}]${propsStr}`);
    }
    lines.push("");
  }

  // Development Tooling
  const toolingMd = toolingToMarkdown(spec.tooling);
  if (toolingMd.includes("###")) {
    lines.push(toolingMd);
  }

  // AI-specific instructions derived from tooling
  const aiInstructions = toolingToAiInstructions(spec.tooling);
  if (aiInstructions) {
    lines.push("## Rules for AI");
    lines.push("");
    lines.push("When writing code for this project, follow these rules:");
    lines.push("");
    for (const line of aiInstructions.split("\n")) {
      if (line) lines.push(`- ${line}`);
    }
    lines.push("");
  }

  // Recommended MCP servers
  if (spec.mcpRecommendations.length > 0) {
    lines.push("## Recommended MCP Servers");
    lines.push("");
    lines.push("These MCP servers are recommended for this project:");
    lines.push("");
    for (const rec of spec.mcpRecommendations) {
      const envNote = rec.env ? ` (requires: ${Object.keys(rec.env).join(", ")})` : "";
      lines.push(`- **${rec.name}** — ${rec.description}${envNote}`);
      lines.push(`  _Why: ${rec.reason}_`);
    }
    lines.push("");
  }

  // Detailed file references
  lines.push("## Detailed Specifications");
  lines.push("");
  lines.push("For more detailed information, read these files in the `.specwriter/` directory:");
  lines.push("");
  lines.push("| File | Contents |");
  lines.push("|------|----------|");
  lines.push("| `spec.md` | Full project overview, tech stack, structure |");
  lines.push("| `rules.md` | Coding conventions, naming patterns, architecture rules |");
  lines.push("| `pages/_index.md` | Complete route map and page hierarchy |");
  lines.push("| `pages/<name>.md` | Individual page spec with wireframe and component list |");
  lines.push("| `components/_index.md` | Component registry with dependency graph |");
  lines.push("| `components/<name>.md` | Individual component: props, state, events, children |");
  lines.push("");

  return lines.join("\n");
}

// ─── Injection into existing AI config files ───

async function injectReference(
  spec: SpecOutput,
  projectRoot: string,
  target: AiConfigTarget
): Promise<void> {
  const fullPath = path.join(projectRoot, target.injectPath);

  // Create directory if needed
  if (target.needsDir) {
    await fs.mkdir(path.join(projectRoot, target.needsDir), { recursive: true });
  }

  switch (target.format) {
    case "markdown":
      await injectMarkdown(fullPath, spec, target);
      break;
    case "mdc":
      await injectMdc(fullPath, spec, target);
      break;
    case "text":
      await injectText(fullPath, spec, target);
      break;
    case "yaml":
      await injectYaml(fullPath, spec, target);
      break;
    case "json":
      await injectJson(fullPath, spec, target);
      break;
  }
}

function buildReferenceBlock(spec: SpecOutput): string {
  const name = spec.project.name;
  return [
    `## Specwriter: ${name}`,
    "",
    "This project has auto-generated specifications in the `.specwriter/` directory.",
    "Before working on this project, read `.specwriter/AI_CONTEXT.md` for a complete overview.",
    "",
    "Key files:",
    "- `.specwriter/AI_CONTEXT.md` — Full project context (tech stack, routes, components)",
    "- `.specwriter/spec.md` — Project overview and structure",
    "- `.specwriter/rules.md` — Coding conventions and patterns",
    "- `.specwriter/pages/<name>.md` — Per-page specs with wireframes",
    "- `.specwriter/components/<name>.md` — Per-component specs (props, state, events)",
  ].join("\n");
}

function buildReferenceOneLiner(spec: SpecOutput): string {
  return `Read .specwriter/AI_CONTEXT.md for complete project specifications (${spec.project.name}: ${spec.project.framework.name}, ${spec.components.length} components, ${spec.pageTree.routes.length} routes).`;
}

// ─── Format-specific injectors ───

async function injectMarkdown(
  filePath: string,
  spec: SpecOutput,
  _target: AiConfigTarget
): Promise<void> {
  const block = `\n${MARKER_START}\n${buildReferenceBlock(spec)}\n${MARKER_END}\n`;

  let content = "";
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist yet, create with just the block
    await fs.writeFile(filePath, block.trim() + "\n");
    return;
  }

  // Replace existing block or append
  if (content.includes(MARKER_START)) {
    const regex = new RegExp(
      `${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`,
      "g"
    );
    content = content.replace(regex, block.trim());
  } else {
    content = content.trimEnd() + "\n\n" + block.trim() + "\n";
  }

  await fs.writeFile(filePath, content);
}

async function injectMdc(
  filePath: string,
  spec: SpecOutput,
  _target: AiConfigTarget
): Promise<void> {
  const content = [
    "---",
    "description: Project specifications generated by specwriter",
    "globs: **",
    "alwaysApply: true",
    "---",
    "",
    buildReferenceBlock(spec),
    "",
  ].join("\n");

  await fs.writeFile(filePath, content);
}

async function injectText(
  filePath: string,
  spec: SpecOutput,
  _target: AiConfigTarget
): Promise<void> {
  const oneLiner = buildReferenceOneLiner(spec);

  let content = "";
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    await fs.writeFile(filePath, oneLiner + "\n");
    return;
  }

  // Remove old specwriter reference and add new
  const lines = content.split("\n").filter(
    (line) => !line.includes(".specwriter/") && !line.includes("specwriter:")
  );
  lines.push(oneLiner);

  await fs.writeFile(filePath, lines.join("\n") + "\n");
}

async function injectYaml(
  filePath: string,
  spec: SpecOutput,
  _target: AiConfigTarget
): Promise<void> {
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    // Create minimal aider config with read reference
    content = [
      "# Aider configuration",
      "read:",
      "  - .specwriter/AI_CONTEXT.md",
      "",
    ].join("\n");
    await fs.writeFile(filePath, content);
    return;
  }

  // Add read entry if not present
  if (!content.includes(".specwriter/")) {
    if (content.includes("read:")) {
      content = content.replace(
        /^(read:\s*\n)/m,
        "$1  - .specwriter/AI_CONTEXT.md\n"
      );
    } else {
      content += "\nread:\n  - .specwriter/AI_CONTEXT.md\n";
    }
    await fs.writeFile(filePath, content);
  }
}

async function injectJson(
  filePath: string,
  spec: SpecOutput,
  _target: AiConfigTarget
): Promise<void> {
  let obj: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(filePath, "utf-8");
    obj = JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid
  }

  // Add specwriter docs reference
  if (!obj.docs) obj.docs = [];
  const docs = obj.docs as Array<Record<string, string>>;
  const existingIdx = docs.findIndex((d) => d.title === "Specwriter");
  const entry = {
    title: "Specwriter",
    content: buildReferenceOneLiner(spec),
  };
  if (existingIdx >= 0) {
    docs[existingIdx] = entry;
  } else {
    docs.push(entry);
  }

  await fs.writeFile(filePath, JSON.stringify(obj, null, 2) + "\n");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── MCP Server auto-registration ───

interface McpConfigLocation {
  name: string;
  detectPath: string;
  configPath: string;
  format: "claude" | "cursor" | "generic-json";
}

const MCP_CONFIGS: McpConfigLocation[] = [
  {
    name: "Claude Code",
    detectPath: ".claude",
    configPath: ".claude/settings.local.json",
    format: "claude",
  },
  {
    name: "Cursor",
    detectPath: ".cursor",
    configPath: ".cursor/mcp.json",
    format: "cursor",
  },
  {
    name: "Windsurf",
    detectPath: ".windsurf",
    configPath: ".windsurf/mcp.json",
    format: "generic-json",
  },
  {
    name: "Cline",
    detectPath: ".cline",
    configPath: ".cline/mcp_settings.json",
    format: "generic-json",
  },
];

async function injectMcpConfigs(projectRoot: string, spec: SpecOutput): Promise<string[]> {
  const injected: string[] = [];

  const mcpServerDef = {
    command: "npx",
    args: ["-y", "specwriter", "serve", projectRoot],
  };

  // Resolve env vars from .env files and system env
  const resolvedEnvs = await resolveEnvVars(projectRoot, spec.mcpRecommendations);

  // Build ALL recommended MCP configs
  const recommendedConfigs: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const rec of spec.mcpRecommendations) {
    const config: { command: string; args: string[]; env?: Record<string, string> } = {
      command: rec.command,
      args: rec.args,
    };
    if (rec.env) {
      config.env = {};
      const resolved = resolvedEnvs.get(rec.id);
      for (const [key] of Object.entries(rec.env)) {
        // Use resolved value if found, otherwise placeholder
        if (resolved && resolved[key]) {
          config.env[key] = resolved[key].value;
        } else {
          config.env[key] = `<SET_YOUR_${key}>`;
        }
      }
    }
    recommendedConfigs[rec.id] = config;
  }

  // Track what was auto-resolved
  const autoActivated: string[] = [];
  const needsSetup: string[] = [];

  for (const rec of spec.mcpRecommendations) {
    if (!rec.env) {
      autoActivated.push(rec.name);
    } else if (resolvedEnvs.has(rec.id)) {
      const resolved = resolvedEnvs.get(rec.id)!;
      const allKeys = Object.keys(rec.env);
      const resolvedKeys = Object.keys(resolved);
      if (resolvedKeys.length >= allKeys.length) {
        autoActivated.push(`${rec.name} (from ${resolved[resolvedKeys[0]].source})`);
      } else {
        needsSetup.push(rec.name);
      }
    } else {
      needsSetup.push(rec.name);
    }
  }

  for (const mcpConfig of MCP_CONFIGS) {
    const detectPath = path.join(projectRoot, mcpConfig.detectPath);
    try {
      await fs.access(detectPath);
    } catch {
      continue;
    }

    try {
      const configPath = path.join(projectRoot, mcpConfig.configPath);
      await fs.mkdir(path.dirname(configPath), { recursive: true });

      let obj: Record<string, unknown> = {};
      try {
        const content = await fs.readFile(configPath, "utf-8");
        obj = JSON.parse(content);
      } catch {
        // Start fresh
      }

      if (!obj.mcpServers) obj.mcpServers = {};
      const servers = obj.mcpServers as Record<string, unknown>;

      // Always register specwriter itself
      servers["specwriter"] = mcpServerDef;

      // Register ALL recommended MCP servers
      for (const [id, config] of Object.entries(recommendedConfigs)) {
        if (!(id in servers)) {
          servers[id] = config;
        }
      }

      await fs.writeFile(configPath, JSON.stringify(obj, null, 2) + "\n");
      injected.push(mcpConfig.name);
    } catch {
      // Skip on error
    }
  }

  // Log activation status
  if (autoActivated.length > 0) {
    console.log(`  MCP activated:   ${autoActivated.join(", ")}`);
  }
  if (needsSetup.length > 0) {
    console.log(`  MCP pending:     ${needsSetup.join(", ")} (need API keys in .env)`);
  }

  return injected;
}
