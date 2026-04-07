import fs from "node:fs/promises";
import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { ComponentInfo } from "../types/component.js";
import { toolingToAiInstructions } from "../analyzers/tooling.js";
import { buildMcpServerConfigs } from "../analyzers/mcp-recommendations.js";
import { resolveEnvVars } from "../analyzers/env-resolver.js";
import { inferServiceProfile, detectCodePatterns } from "../analyzers/service-inference.js";
import { analyzeApiPatterns, apiPatternsToMarkdown } from "../analyzers/api-patterns.js";
import { detectUiPatterns, uiPatternsToMarkdown } from "../analyzers/ui-patterns.js";

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
  await writeUniversalContext(spec, outputDir, config);

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
  outputDir: string,
  config: AnalysisConfig,
): Promise<void> {
  const { project, components, pageTree } = spec;

  const apiPatterns = await analyzeApiPatterns(config.root, components, pageTree.routes);
  const uiPatterns = detectUiPatterns(components);

  const content = buildFullContext(spec, apiPatterns, uiPatterns);
  await fs.writeFile(path.join(outputDir, "AI_CONTEXT.md"), content);
}

function buildFullContext(
  spec: SpecOutput,
  apiPatterns: Awaited<ReturnType<typeof analyzeApiPatterns>>,
  uiPatterns: ReturnType<typeof detectUiPatterns>,
): string {
  const { project, rules, pageTree, components } = spec;
  const L: string[] = [];

  // ─── Service profile inference ───
  const profile = inferServiceProfile(project, components, pageTree.routes);
  const codePatterns = detectCodePatterns(components);

  // ─── Header: one-line summary ───
  L.push(`# ${project.name}`);
  L.push("");
  L.push(`> ${profile.summary}`);
  if (project.description) L.push(`> ${project.description}`);
  L.push("");

  // ─── What this project does ───
  if (profile.domain.length > 0 || profile.features.length > 0) {
    L.push("## What this project does");
    L.push("");
    if (profile.domain.length > 0) {
      L.push(`**Domain:** ${profile.domain.join(", ")}`);
    }
    L.push(`**Architecture:** ${profile.architecture}`);
    if (profile.auth) L.push(`**Auth:** ${profile.auth}`);
    if (profile.dataPatterns.length > 0) {
      L.push(`**Data:** ${profile.dataPatterns.join(", ")}`);
    }
    if (profile.features.length > 0) {
      L.push(`**Features:** ${profile.features.join(", ")}`);
    }
    L.push("");
  }

  // ─── Tech stack (compact) ───
  const stackParts: string[] = [
    project.framework.name + " " + project.framework.version,
    project.techStack.language,
  ];
  if (project.techStack.styling.length > 0) stackParts.push(project.techStack.styling.join("+"));
  if (project.techStack.stateManagement.length > 0) stackParts.push(project.techStack.stateManagement.join("+"));
  L.push(`**Stack:** ${stackParts.join(" · ")} · ${project.techStack.packageManager}`);
  L.push("");

  // ─── Project structure (only meaningful dirs, max 10) ───
  const meaningfulDirs = spec.directories
    .filter((d) => d.componentCount > 0 || d.role !== "Module")
    .slice(0, 10);
  if (meaningfulDirs.length > 0) {
    L.push("## Structure");
    L.push("");
    for (const dir of meaningfulDirs) {
      L.push(`- \`${dir.path}/\` — ${dir.description}`);
    }
    L.push("");
  }

  // ─── Routes (compact, max 20) ───
  const pageRoutes = pageTree.routes.filter((r) => !r.isApiRoute);
  const apiRoutes = pageTree.routes.filter((r) => r.isApiRoute);

  if (pageRoutes.length > 0) {
    L.push("## Routes");
    L.push("");
    for (const route of pageRoutes.slice(0, 20)) {
      L.push(`- \`${route.path}\` → \`${route.filePath}\``);
    }
    if (pageRoutes.length > 20) L.push(`- ... and ${pageRoutes.length - 20} more`);
    L.push("");
  }

  if (apiRoutes.length > 0) {
    L.push("## API");
    L.push("");
    for (const route of apiRoutes.slice(0, 15)) {
      L.push(`- \`${route.path}\` → \`${route.filePath}\``);
    }
    if (apiRoutes.length > 15) L.push(`- ... and ${apiRoutes.length - 15} more`);
    L.push("");
  }

  // ─── Key components (only those with props/state, max 25) ───
  const keyComponents = components
    .filter((c) => c.type !== "utility" && c.type !== "hook")
    .sort((a, b) => (b.props.length + b.children.length) - (a.props.length + a.children.length))
    .slice(0, 25);

  if (keyComponents.length > 0) {
    L.push("## Key Components");
    L.push("");
    L.push("| Component | File | Props |");
    L.push("|-----------|------|-------|");
    for (const comp of keyComponents) {
      const propsStr = comp.props.length > 0
        ? comp.props.map((p) => p.name).join(", ")
        : "—";
      L.push(`| **${comp.name}** | \`${comp.filePath}\` | ${propsStr} |`);
    }
    L.push("");
    if (components.length > 25) {
      L.push(`_${components.length - 25} more components in \`.specwriter/components/\`_`);
      L.push("");
    }
  }

  // ─── Rules for AI (from tooling + code patterns) ───
  const aiInstructions = toolingToAiInstructions(spec.tooling);
  const allRules: string[] = [];

  if (aiInstructions) {
    for (const line of aiInstructions.split("\n")) {
      if (line.trim()) allRules.push(line);
    }
  }

  // Code pattern rules
  for (const pattern of codePatterns) {
    if (pattern.frequency === "always" || pattern.frequency === "common") {
      allRules.push(pattern.description);
    }
  }

  // Naming conventions (only if non-obvious)
  if (rules.naming.files !== "unknown" && rules.naming.files !== "PascalCase") {
    allRules.push(`File naming: ${rules.naming.files}`);
  }

  if (allRules.length > 0) {
    L.push("## Rules");
    L.push("");
    for (const rule of allRules) {
      L.push(`- ${rule}`);
    }
    L.push("");
  }

  // ─── API patterns ───
  if (apiPatterns.endpoints.length > 0 || apiPatterns.apiUtilFile) {
    L.push(apiPatternsToMarkdown(apiPatterns));
  }

  // ─── UI patterns (from actual usage graph, not hardcoded) ───
  const uiMd = uiPatternsToMarkdown(uiPatterns);
  if (uiMd) {
    L.push(uiMd);
  }

  // ─── Component tree (replaces ASCII wireframe) ───
  const componentTree = buildComponentTree(components);
  if (componentTree) {
    L.push("## Component Tree");
    L.push("");
    L.push("```");
    L.push(componentTree);
    L.push("```");
    L.push("");
  }

  // ─── Features ───
  L.push("## Features");
  L.push("");
  L.push("When building a new feature:");
  L.push("1. Create `.specwriter/features/<name>.md` with the full spec before coding");
  L.push("2. Include: what it does, pages, components, API endpoints, data flow, edge cases");
  L.push("3. Implement based on the spec");
  L.push("4. Update the spec when requirements change");
  L.push("");

  // List existing features if any
  if (spec.directories.some((d) => d.path.includes("features"))) {
    L.push("Existing features: check `.specwriter/features/` for current specs.");
  }

  // ─── Reference ───
  L.push("## Details");
  L.push("");
  L.push("- `.specwriter/components/<name>.md` — component specs");
  L.push("- `.specwriter/features/<name>.md` — feature specs");
  L.push("");

  return L.join("\n");
}

function buildComponentTree(components: ComponentInfo[]): string | null {
  if (components.length === 0) return null;

  // Build parent→children map from actual usage
  const childMap = new Map<string, string[]>();
  const compSet = new Set(components.map((c) => c.name));
  const hasParent = new Set<string>();

  for (const comp of components) {
    const children = comp.children.filter((c) => compSet.has(c));
    if (children.length > 0) {
      childMap.set(comp.name, children);
      for (const child of children) hasParent.add(child);
    }
  }

  // Root components: used but not children of anything
  const roots = components
    .filter((c) => !hasParent.has(c.name) && (c.type === "page" || c.type === "layout" || childMap.has(c.name)))
    .slice(0, 10);

  if (roots.length === 0) return null;

  const lines: string[] = [];
  const rendered = new Set<string>();

  function render(name: string, indent: number) {
    if (rendered.has(name) || indent > 4) return;
    rendered.add(name);
    const prefix = "  ".repeat(indent);
    const comp = components.find((c) => c.name === name);
    const typeTag = comp?.type && comp.type !== "component" ? ` [${comp.type}]` : "";
    lines.push(`${prefix}${name}${typeTag}`);
    const children = childMap.get(name) || [];
    for (const child of children.slice(0, 6)) {
      render(child, indent + 1);
    }
    if (children.length > 6) {
      lines.push(`${prefix}  ... +${children.length - 6} more`);
    }
  }

  for (const root of roots) {
    render(root.name, 0);
  }

  return lines.length > 0 ? lines.join("\n") : null;
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
