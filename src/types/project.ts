export interface ProjectInfo {
  name: string;
  version: string;
  description: string;
  root: string;
  framework: FrameworkInfo;
  techStack: TechStackInfo;
  structure: ProjectStructure;
}

export interface FrameworkInfo {
  id: FrameworkId;
  name: string;
  version: string;
  confidence: number;
  routingStrategy: "file-based" | "config-based" | "unknown";
  features: string[];
}

export type FrameworkId =
  | "nextjs"
  | "react"
  | "nuxt"
  | "vue"
  | "sveltekit"
  | "svelte"
  | "angular"
  | "generic";

export interface TechStackInfo {
  language: "typescript" | "javascript" | "mixed";
  styling: string[];
  stateManagement: string[];
  testing: string[];
  buildTool: string;
  packageManager: "npm" | "yarn" | "pnpm" | "bun";
  linting: string[];
  otherLibraries: LibraryInfo[];
}

export interface LibraryInfo {
  name: string;
  version: string;
  category: string;
}

export interface ProjectStructure {
  srcDir: string;
  pagesDir: string | null;
  componentsDir: string | null;
  apiDir: string | null;
  publicDir: string | null;
  configFiles: string[];
}

export interface DetectionResult {
  frameworkId: FrameworkId;
  confidence: number;
  evidence: string[];
}
