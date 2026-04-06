import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Try to find and execute the Rust core binary.
 * Returns the parsed JSON snapshot, or null if Rust core is not available.
 */
export function tryRustCore(projectRoot: string): RustSnapshot | null {
  const binaryName = process.platform === "win32" ? "specwriter-core.exe" : "specwriter-core";

  // Search order:
  // 1. Same directory as the node module (npm distributed)
  // 2. core/target/release (development)
  // 3. System PATH
  const searchPaths = [
    path.join(__dirname, "..", "..", "bin", binaryName),
    path.join(__dirname, "..", "..", "..", "core", "target", "release", binaryName),
    binaryName, // System PATH
  ];

  for (const binPath of searchPaths) {
    try {
      // Check if exists (skip for PATH lookup)
      if (binPath !== binaryName && !fs.existsSync(binPath)) continue;

      const result = execFileSync(binPath, [projectRoot, "-f", "summary"], {
        encoding: "utf-8",
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024, // 50MB
        stdio: ["pipe", "pipe", "pipe"],
      });

      return JSON.parse(result) as RustSnapshot;
    } catch {
      continue;
    }
  }

  return null;
}

export interface RustSnapshot {
  root: string;
  files: { path: string; extension: string; size: number }[];
  components: {
    name: string;
    file_path: string;
    component_type: string;
    export_type: string;
    props: { name: string; prop_type: string; required: boolean; default_value: string | null }[];
    state: { name: string; state_type: string; source: string; setter: string | null; initial_value: string | null }[];
    children: string[];
    imports: { source: string; specifiers: string[]; is_default: boolean; is_type: boolean }[];
    is_client: boolean;
    is_server: boolean;
    line_start: number;
    line_end: number;
    description: string;
  }[];
  routes: {
    path: string;
    file_path: string;
    name: string;
    is_api: boolean;
    is_dynamic: boolean;
    params: string[];
  }[];
  directories: { path: string; role: string; file_count: number; component_count: number }[];
  framework: { id: string; confidence: number; evidence: string[] };
  stats: {
    total_files: number;
    scanned_files: number;
    components_found: number;
    parse_errors: number;
    duration_ms: number;
  };
}
