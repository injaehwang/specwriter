export { runAnalysis } from "./core/analyzer.js";
export { startMcpServer } from "./mcp/server.js";
export { detectFramework } from "./detect/index.js";
export { getAdapter } from "./adapters/registry.js";
export { renderWireframe, buildWireframeFromComponents } from "./wireframe/ascii-renderer.js";

export type { AnalysisConfig, SpecOutput } from "./types/spec.js";
export type { ProjectInfo, FrameworkInfo, FrameworkId } from "./types/project.js";
export type { ComponentInfo, PropInfo, StateInfo } from "./types/component.js";
export type { RouteInfo, PageInfo, PageTree } from "./types/page.js";
export type { FrameworkAdapter } from "./adapters/types.js";
