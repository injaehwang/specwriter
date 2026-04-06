import { AnalysisConfig } from "../types/spec.js";
import { RouteInfo } from "../types/page.js";
import { ComponentInfo } from "../types/component.js";
import { ProjectRules } from "../types/spec.js";
import { ProjectStructure, TechStackInfo } from "../types/project.js";

export interface FrameworkAdapter {
  /** Framework identifier */
  id: string;

  /** Human-readable framework name */
  name: string;

  /** Detect project structure directories */
  detectStructure(projectRoot: string): Promise<ProjectStructure>;

  /** Detect tech stack details */
  detectTechStack(projectRoot: string): Promise<Partial<TechStackInfo>>;

  /** Extract all routes/pages from the project */
  extractRoutes(projectRoot: string, config: AnalysisConfig): Promise<RouteInfo[]>;

  /** Extract component information from a single file */
  extractComponent(filePath: string, content: string): Promise<ComponentInfo | null>;

  /** Detect coding conventions */
  detectConventions(projectRoot: string, config: AnalysisConfig): Promise<Partial<ProjectRules>>;

  /** Get file patterns to scan for components */
  getComponentGlobs(): string[];

  /** Get file patterns to scan for pages/routes */
  getPageGlobs(): string[];
}
