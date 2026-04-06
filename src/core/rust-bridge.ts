import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

/**
 * Resolve the platform-specific package name
 */
function getPlatformPackage(): string {
  const platform = process.platform;
  const arch = process.arch;

  const map: Record<string, string> = {
    "win32-x64": "specwriter-core-win32-x64",
    "darwin-arm64": "specwriter-core-darwin-arm64",
    "darwin-x64": "specwriter-core-darwin-x64",
    "linux-x64": "specwriter-core-linux-x64",
  };

  return map[`${platform}-${arch}`] || "";
}

/**
 * Try to find and execute the Rust core binary.
 * Returns the parsed JSON snapshot, or null if Rust core is not available.
 */
export function tryRustCore(projectRoot: string): RustSnapshot | null {
  const binaryPath = findBinary();
  if (!binaryPath) return null;

  try {
    const result = execFileSync(binaryPath, [projectRoot, "-f", "summary"], {
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return JSON.parse(result) as RustSnapshot;
  } catch {
    return null;
  }
}

function findBinary(): string | null {
  const binaryName = process.platform === "win32" ? "specwriter-core.exe" : "specwriter-core";

  // 1. Platform-specific npm package (esbuild/swc pattern)
  const pkgName = getPlatformPackage();
  if (pkgName) {
    try {
      const binPath = require.resolve(pkgName);
      const resolved = require(pkgName);
      if (typeof resolved === "string" && fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // Package not installed
    }
  }

  // 2. Bundled in bin/ (legacy, direct include)
  const bundled = path.join(__dirname, "..", "..", "bin", binaryName);
  if (fs.existsSync(bundled)) return bundled;

  // 3. Development: core/target/release
  const dev = path.join(__dirname, "..", "..", "..", "core", "target", "release", binaryName);
  if (fs.existsSync(dev)) return dev;

  // 4. System PATH
  try {
    execFileSync(binaryName, ["--help"], { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
    return binaryName;
  } catch {
    // Not on PATH
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
