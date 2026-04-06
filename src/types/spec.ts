import { ProjectInfo } from "./project.js";
import { PageTree } from "./page.js";
import { ComponentInfo, ComponentGraph } from "./component.js";
import type { ToolingAnalysis } from "../analyzers/tooling.js";
import type { McpRecommendation } from "../analyzers/mcp-recommendations.js";
import type { DirectorySpec } from "../analyzers/directory-roles.js";

export interface SpecOutput {
  manifest: ManifestInfo;
  project: ProjectInfo;
  rules: ProjectRules;
  pageTree: PageTree;
  components: ComponentInfo[];
  componentGraph: ComponentGraph;
  directories: DirectorySpec[];
  tooling: ToolingAnalysis;
  mcpRecommendations: McpRecommendation[];
}

export interface ManifestInfo {
  version: string;
  generatedAt: string;
  toolVersion: string;
  frameworkDetected: string;
  analyzedFiles: number;
  duration: number;
}

export interface ProjectRules {
  naming: NamingConventions;
  patterns: ArchitecturePattern[];
  fileOrganization: FileOrganizationRule[];
  importConventions: ImportConvention[];
}

export interface NamingConventions {
  components: NamingStyle;
  files: NamingStyle;
  functions: NamingStyle;
  variables: NamingStyle;
  cssClasses: NamingStyle;
  directories: NamingStyle;
}

export type NamingStyle =
  | "PascalCase"
  | "camelCase"
  | "kebab-case"
  | "snake_case"
  | "UPPER_SNAKE_CASE"
  | "mixed"
  | "unknown";

export interface ArchitecturePattern {
  name: string;
  description: string;
  locations: string[];
  examples: string[];
}

export interface FileOrganizationRule {
  pattern: string;
  purpose: string;
  examples: string[];
}

export interface ImportConvention {
  pattern: string;
  description: string;
  example: string;
}

export interface AnalysisConfig {
  root: string;
  output: string;
  framework: string;
  include: string[];
  exclude: string[];
  depth: number;
  wireframes: boolean;
  format: "json" | "md" | "both";
  aiTargets: "auto" | string[];
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  root: ".",
  output: ".specwriter",
  framework: "auto",
  include: ["src/**", "app/**", "pages/**", "components/**", "lib/**"],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/.svelte-kit/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/__mocks__/**",
  ],
  depth: 3,
  wireframes: true,
  format: "both",
  aiTargets: "auto",
};
