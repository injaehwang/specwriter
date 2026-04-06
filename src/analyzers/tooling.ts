import fs from "node:fs/promises";
import path from "node:path";

/**
 * Detailed analysis of project development tooling
 */
export interface ToolingAnalysis {
  typescript: TypeScriptConfig | null;
  linter: LinterConfig | null;
  formatter: FormatterConfig | null;
  testing: TestingConfig | null;
  bundler: BundlerConfig | null;
  git: GitConfig | null;
  ci: CIConfig | null;
}

export interface TypeScriptConfig {
  strict: boolean;
  strictNullChecks: boolean;
  noImplicitAny: boolean;
  target: string;
  module: string;
  paths: Record<string, string[]>;
  baseUrl: string | null;
  jsx: string | null;
  importantFlags: string[];
}

export interface LinterConfig {
  tool: "eslint" | "biome" | "oxlint" | "unknown";
  configFile: string;
  keyRules: LinterRule[];
  extends: string[];
  plugins: string[];
}

export interface LinterRule {
  name: string;
  severity: "error" | "warn" | "off";
  description: string;
}

export interface FormatterConfig {
  tool: "prettier" | "biome" | "dprint" | "unknown";
  configFile: string;
  settings: Record<string, unknown>;
}

export interface TestingConfig {
  framework: string;
  configFile: string | null;
  testPattern: string;
  coverageEnabled: boolean;
  setupFiles: string[];
}

export interface BundlerConfig {
  tool: string;
  configFile: string | null;
}

export interface GitConfig {
  hooks: string[];
  hasHusky: boolean;
  hasLintStaged: boolean;
  commitConvention: string | null;
}

export interface CIConfig {
  provider: string;
  configFile: string;
}

/**
 * Analyze all development tooling in the project
 */
export async function analyzeTooling(projectRoot: string): Promise<ToolingAnalysis> {
  const [typescript, linter, formatter, testing, bundler, git, ci] = await Promise.all([
    analyzeTypeScript(projectRoot),
    analyzeLinter(projectRoot),
    analyzeFormatter(projectRoot),
    analyzeTesting(projectRoot),
    analyzeBundler(projectRoot),
    analyzeGit(projectRoot),
    analyzeCI(projectRoot),
  ]);

  return { typescript, linter, formatter, testing, bundler, git, ci };
}

// ─── TypeScript ───

async function analyzeTypeScript(root: string): Promise<TypeScriptConfig | null> {
  const tsConfigPath = path.join(root, "tsconfig.json");
  let raw: string;
  try {
    raw = await fs.readFile(tsConfigPath, "utf-8");
  } catch {
    return null;
  }

  // Strip comments (JSON5-like) before parsing
  const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const co = (config.compilerOptions || {}) as Record<string, unknown>;
  const importantFlags: string[] = [];

  if (co.strict) importantFlags.push("strict mode enabled");
  if (co.noUnusedLocals) importantFlags.push("no unused locals");
  if (co.noUnusedParameters) importantFlags.push("no unused parameters");
  if (co.noFallthroughCasesInSwitch) importantFlags.push("no fallthrough in switch");
  if (co.exactOptionalPropertyTypes) importantFlags.push("exact optional property types");
  if (co.noUncheckedIndexedAccess) importantFlags.push("no unchecked indexed access");
  if (co.verbatimModuleSyntax) importantFlags.push("verbatim module syntax");
  if (co.isolatedModules) importantFlags.push("isolated modules");

  return {
    strict: !!co.strict,
    strictNullChecks: co.strictNullChecks !== false && !!co.strict,
    noImplicitAny: co.noImplicitAny !== false && !!co.strict,
    target: (co.target as string) || "unknown",
    module: (co.module as string) || "unknown",
    paths: (co.paths as Record<string, string[]>) || {},
    baseUrl: (co.baseUrl as string) || null,
    jsx: (co.jsx as string) || null,
    importantFlags,
  };
}

// ─── Linter ───

async function analyzeLinter(root: string): Promise<LinterConfig | null> {
  // Check for ESLint
  const eslintFiles = [
    ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml",
    ".eslintrc.yaml", ".eslintrc", "eslint.config.js", "eslint.config.mjs",
    "eslint.config.ts",
  ];
  for (const file of eslintFiles) {
    try {
      const content = await fs.readFile(path.join(root, file), "utf-8");
      return parseEslintConfig(file, content);
    } catch {
      continue;
    }
  }

  // Check for Biome
  try {
    const content = await fs.readFile(path.join(root, "biome.json"), "utf-8");
    return parseBiomeConfig("biome.json", content);
  } catch {
    // No biome
  }

  return null;
}

function parseEslintConfig(file: string, content: string): LinterConfig {
  const config: LinterConfig = {
    tool: "eslint",
    configFile: file,
    keyRules: [],
    extends: [],
    plugins: [],
  };

  // Extract extends
  const extendsMatch = content.match(/extends\s*[:\[=]\s*\[?([^\]]+)\]?/);
  if (extendsMatch) {
    const items = extendsMatch[1].match(/['"]([^'"]+)['"]/g) || [];
    config.extends = items.map((s) => s.replace(/['"]/g, ""));
  }

  // Extract plugins
  const pluginsMatch = content.match(/plugins\s*[:\[=]\s*\[?([^\]]+)\]?/);
  if (pluginsMatch) {
    const items = pluginsMatch[1].match(/['"]([^'"]+)['"]/g) || [];
    config.plugins = items.map((s) => s.replace(/['"]/g, ""));
  }

  // Extract key rules
  const rulesMatch = content.match(/rules\s*[:{]\s*\{([\s\S]*?)\}/);
  if (rulesMatch) {
    const rulesStr = rulesMatch[1];
    const ruleRegex = /['"]?([@\w/-]+)['"]?\s*:\s*['"]?(error|warn|off|\d)['"]?/g;
    let match;
    while ((match = ruleRegex.exec(rulesStr)) !== null) {
      const severity = match[2] === "2" || match[2] === "error" ? "error"
        : match[2] === "1" || match[2] === "warn" ? "warn" : "off";
      if (severity !== "off") {
        config.keyRules.push({
          name: match[1],
          severity: severity as "error" | "warn",
          description: "",
        });
      }
    }
  }

  return config;
}

function parseBiomeConfig(file: string, content: string): LinterConfig {
  return {
    tool: "biome",
    configFile: file,
    keyRules: [],
    extends: [],
    plugins: [],
  };
}

// ─── Formatter ───

async function analyzeFormatter(root: string): Promise<FormatterConfig | null> {
  const prettierFiles = [
    ".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.cjs",
    ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.toml",
    "prettier.config.js", "prettier.config.mjs",
  ];

  for (const file of prettierFiles) {
    try {
      const content = await fs.readFile(path.join(root, file), "utf-8");
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(content);
      } catch {
        // YAML or JS config — extract what we can
      }
      return { tool: "prettier", configFile: file, settings };
    } catch {
      continue;
    }
  }

  // Check package.json for prettier config
  try {
    const pkgContent = await fs.readFile(path.join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent);
    if (pkg.prettier) {
      return { tool: "prettier", configFile: "package.json (prettier key)", settings: pkg.prettier };
    }
  } catch {
    // No config
  }

  return null;
}

// ─── Testing ───

async function analyzeTesting(root: string): Promise<TestingConfig | null> {
  // Vitest
  const vitestFiles = ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"];
  for (const file of vitestFiles) {
    try {
      await fs.access(path.join(root, file));
      return {
        framework: "vitest",
        configFile: file,
        testPattern: "**/*.{test,spec}.{ts,tsx,js,jsx}",
        coverageEnabled: false,
        setupFiles: [],
      };
    } catch {
      continue;
    }
  }

  // Jest
  const jestFiles = ["jest.config.ts", "jest.config.js", "jest.config.mjs"];
  for (const file of jestFiles) {
    try {
      await fs.access(path.join(root, file));
      return {
        framework: "jest",
        configFile: file,
        testPattern: "**/*.{test,spec}.{ts,tsx,js,jsx}",
        coverageEnabled: false,
        setupFiles: [],
      };
    } catch {
      continue;
    }
  }

  // Check package.json for jest config
  try {
    const pkgContent = await fs.readFile(path.join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent);
    if (pkg.jest) {
      return {
        framework: "jest",
        configFile: "package.json (jest key)",
        testPattern: pkg.jest.testMatch?.[0] || "**/*.{test,spec}.{ts,tsx,js,jsx}",
        coverageEnabled: !!pkg.jest.collectCoverage,
        setupFiles: pkg.jest.setupFilesAfterSetup || [],
      };
    }
  } catch {
    // No config
  }

  return null;
}

// ─── Bundler ───

async function analyzeBundler(root: string): Promise<BundlerConfig | null> {
  const bundlers: [string, string[]][] = [
    ["Vite", ["vite.config.ts", "vite.config.js", "vite.config.mts"]],
    ["Webpack", ["webpack.config.js", "webpack.config.ts"]],
    ["Turbopack", ["turbo.json"]],
    ["esbuild", ["esbuild.config.js"]],
    ["Rollup", ["rollup.config.js", "rollup.config.mjs"]],
  ];

  for (const [tool, files] of bundlers) {
    for (const file of files) {
      try {
        await fs.access(path.join(root, file));
        return { tool, configFile: file };
      } catch {
        continue;
      }
    }
  }

  return null;
}

// ─── Git ───

async function analyzeGit(root: string): Promise<GitConfig | null> {
  const config: GitConfig = {
    hooks: [],
    hasHusky: false,
    hasLintStaged: false,
    commitConvention: null,
  };

  try {
    await fs.access(path.join(root, ".husky"));
    config.hasHusky = true;

    // List hooks
    try {
      const entries = await fs.readdir(path.join(root, ".husky"));
      config.hooks = entries.filter((e) => !e.startsWith(".") && !e.startsWith("_"));
    } catch {
      // Can't list
    }
  } catch {
    // No husky
  }

  // Check for lint-staged
  try {
    const pkgContent = await fs.readFile(path.join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent);
    if (pkg["lint-staged"]) config.hasLintStaged = true;
  } catch {
    // No config
  }

  // Check for commitlint
  const commitlintFiles = [".commitlintrc.js", ".commitlintrc.json", "commitlint.config.js"];
  for (const file of commitlintFiles) {
    try {
      await fs.access(path.join(root, file));
      config.commitConvention = "conventional commits";
      break;
    } catch {
      continue;
    }
  }

  if (!config.hasHusky && config.hooks.length === 0 && !config.hasLintStaged && !config.commitConvention) {
    return null;
  }

  return config;
}

// ─── CI ───

async function analyzeCI(root: string): Promise<CIConfig | null> {
  const ciSystems: [string, string][] = [
    ["GitHub Actions", ".github/workflows"],
    ["GitLab CI", ".gitlab-ci.yml"],
    ["CircleCI", ".circleci/config.yml"],
    ["Vercel", "vercel.json"],
    ["Netlify", "netlify.toml"],
  ];

  for (const [provider, configPath] of ciSystems) {
    try {
      await fs.access(path.join(root, configPath));
      return { provider, configFile: configPath };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Generate markdown summary of tooling analysis
 */
export function toolingToMarkdown(tooling: ToolingAnalysis): string {
  const lines: string[] = [];

  lines.push("## Development Tooling");
  lines.push("");

  if (tooling.typescript) {
    const ts = tooling.typescript;
    lines.push("### TypeScript");
    lines.push(`- **Strict mode:** ${ts.strict ? "Yes" : "No"}`);
    lines.push(`- **Target:** ${ts.target}`);
    lines.push(`- **Module:** ${ts.module}`);
    if (ts.jsx) lines.push(`- **JSX:** ${ts.jsx}`);
    if (ts.baseUrl) lines.push(`- **Base URL:** \`${ts.baseUrl}\``);
    if (Object.keys(ts.paths).length > 0) {
      lines.push("- **Path aliases:**");
      for (const [alias, targets] of Object.entries(ts.paths)) {
        lines.push(`  - \`${alias}\` → \`${targets[0]}\``);
      }
    }
    if (ts.importantFlags.length > 0) {
      lines.push(`- **Flags:** ${ts.importantFlags.join(", ")}`);
    }
    lines.push("");
  }

  if (tooling.linter) {
    const l = tooling.linter;
    lines.push("### Linter");
    lines.push(`- **Tool:** ${l.tool}`);
    lines.push(`- **Config:** \`${l.configFile}\``);
    if (l.extends.length > 0) lines.push(`- **Extends:** ${l.extends.join(", ")}`);
    if (l.plugins.length > 0) lines.push(`- **Plugins:** ${l.plugins.join(", ")}`);
    if (l.keyRules.length > 0) {
      lines.push("- **Key rules:**");
      for (const rule of l.keyRules.slice(0, 10)) {
        lines.push(`  - \`${rule.name}\`: ${rule.severity}`);
      }
    }
    lines.push("");
  }

  if (tooling.formatter) {
    const f = tooling.formatter;
    lines.push("### Formatter");
    lines.push(`- **Tool:** ${f.tool}`);
    lines.push(`- **Config:** \`${f.configFile}\``);
    const s = f.settings;
    if (s.semi !== undefined) lines.push(`- **Semicolons:** ${s.semi ? "Yes" : "No"}`);
    if (s.singleQuote !== undefined) lines.push(`- **Quotes:** ${s.singleQuote ? "single" : "double"}`);
    if (s.tabWidth) lines.push(`- **Tab width:** ${s.tabWidth}`);
    if (s.useTabs !== undefined) lines.push(`- **Indentation:** ${s.useTabs ? "tabs" : "spaces"}`);
    if (s.trailingComma) lines.push(`- **Trailing comma:** ${s.trailingComma}`);
    if (s.printWidth) lines.push(`- **Print width:** ${s.printWidth}`);
    lines.push("");
  }

  if (tooling.testing) {
    const t = tooling.testing;
    lines.push("### Testing");
    lines.push(`- **Framework:** ${t.framework}`);
    if (t.configFile) lines.push(`- **Config:** \`${t.configFile}\``);
    lines.push(`- **Pattern:** \`${t.testPattern}\``);
    if (t.setupFiles.length > 0) lines.push(`- **Setup:** ${t.setupFiles.map(f => `\`${f}\``).join(", ")}`);
    lines.push("");
  }

  if (tooling.git) {
    const g = tooling.git;
    lines.push("### Git Hooks");
    if (g.hasHusky) lines.push("- **Husky:** enabled");
    if (g.hasLintStaged) lines.push("- **lint-staged:** enabled");
    if (g.hooks.length > 0) lines.push(`- **Hooks:** ${g.hooks.join(", ")}`);
    if (g.commitConvention) lines.push(`- **Commit convention:** ${g.commitConvention}`);
    lines.push("");
  }

  if (tooling.ci) {
    lines.push("### CI/CD");
    lines.push(`- **Provider:** ${tooling.ci.provider}`);
    lines.push(`- **Config:** \`${tooling.ci.configFile}\``);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate AI instructions based on tooling analysis
 */
export function toolingToAiInstructions(tooling: ToolingAnalysis): string {
  const rules: string[] = [];

  if (tooling.typescript) {
    const ts = tooling.typescript;
    if (ts.strict) rules.push("TypeScript strict mode is ON — never use `any`, always handle null/undefined");
    if (ts.noImplicitAny) rules.push("No implicit `any` — all parameters and variables must be typed");
    if (Object.keys(ts.paths).length > 0) {
      const aliases = Object.keys(ts.paths).map(a => `\`${a}\``).join(", ");
      rules.push(`Use path aliases for imports: ${aliases}`);
    }
  }

  if (tooling.formatter) {
    const f = tooling.formatter;
    const s = f.settings;
    const parts: string[] = [];
    if (s.semi === false) parts.push("no semicolons");
    if (s.singleQuote) parts.push("single quotes");
    if (s.tabWidth) parts.push(`${s.tabWidth}-space indent`);
    if (s.useTabs) parts.push("tab indent");
    if (s.trailingComma) parts.push(`trailing comma: ${s.trailingComma}`);
    if (parts.length > 0) {
      rules.push(`Formatting: ${parts.join(", ")} (${f.tool})`);
    }
  }

  if (tooling.linter) {
    const l = tooling.linter;
    if (l.extends.some(e => e.includes("airbnb"))) {
      rules.push("Follows Airbnb style guide");
    }
    if (l.extends.some(e => e.includes("standard"))) {
      rules.push("Follows Standard JS style");
    }
    for (const rule of l.keyRules.filter(r => r.severity === "error").slice(0, 5)) {
      rules.push(`Lint error on: ${rule.name}`);
    }
  }

  if (tooling.testing) {
    rules.push(`Testing with ${tooling.testing.framework} — test files: ${tooling.testing.testPattern}`);
  }

  if (tooling.git) {
    if (tooling.git.hasLintStaged) rules.push("lint-staged runs on commit — code must pass lint before committing");
    if (tooling.git.commitConvention) rules.push(`Use conventional commits format: type(scope): description`);
  }

  return rules.join("\n");
}
