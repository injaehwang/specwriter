import fs from "node:fs/promises";
import path from "node:path";
import { ComponentInfo } from "../types/component.js";
import { RouteInfo } from "../types/page.js";

export interface ApiPatternAnalysis {
  /** How API calls are made in this project */
  callingPattern: string;
  /** API utility file if exists */
  apiUtilFile: string | null;
  /** HTTP client library */
  httpClient: string;
  /** Error handling pattern */
  errorPattern: string;
  /** API endpoints from route handlers */
  endpoints: ApiEndpoint[];
  /** Fetch patterns found in client code */
  fetchPatterns: FetchPattern[];
}

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
}

export interface FetchPattern {
  /** URL or path pattern */
  url: string;
  /** Which component uses this */
  usedIn: string;
  /** HTTP method if detectable */
  method: string;
}

export async function analyzeApiPatterns(
  projectRoot: string,
  components: ComponentInfo[],
  routes: RouteInfo[],
): Promise<ApiPatternAnalysis> {
  // Detect HTTP client
  let httpClient = "fetch (native)";
  for (const comp of components) {
    for (const imp of comp.imports) {
      if (imp.source === "axios" || imp.source.includes("axios")) { httpClient = "axios"; break; }
      if (imp.source === "ky" || imp.source.includes("ky")) { httpClient = "ky"; break; }
      if (imp.source.includes("@tanstack/react-query")) { httpClient = "TanStack Query + fetch"; break; }
    }
  }

  // Find API utility files
  let apiUtilFile: string | null = null;
  const apiFilePatterns = ["lib/api", "utils/api", "services/api", "api/client", "lib/fetch", "utils/fetch"];
  for (const comp of components) {
    for (const pattern of apiFilePatterns) {
      if (comp.filePath.replace(/\\/g, "/").toLowerCase().includes(pattern)) {
        apiUtilFile = comp.filePath;
        break;
      }
    }
  }

  // Extract API endpoints from route handlers
  const apiRoutes = routes.filter((r) => r.isApiRoute);
  const endpoints: ApiEndpoint[] = [];
  for (const route of apiRoutes) {
    const fullPath = path.join(projectRoot, route.filePath);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
      for (const method of methods) {
        if (content.includes(`export async function ${method}`) ||
            content.includes(`export function ${method}`) ||
            content.includes(`export const ${method}`)) {
          endpoints.push({ method, path: route.path, file: route.filePath });
        }
      }
      // If no specific methods found but it's an API route
      if (endpoints.filter((e) => e.file === route.filePath).length === 0) {
        endpoints.push({ method: "ALL", path: route.path, file: route.filePath });
      }
    } catch {
      endpoints.push({ method: "ALL", path: route.path, file: route.filePath });
    }
  }

  // Detect fetch patterns in client components
  const fetchPatterns: FetchPattern[] = [];
  for (const comp of components) {
    if (comp.type === "utility" || comp.type === "hook") continue;
    for (const imp of comp.imports) {
      // Detect react-query/swr usage
      if (imp.specifiers.some((s) => s.includes("useQuery") || s.includes("useMutation"))) {
        fetchPatterns.push({ url: "(via hook)", usedIn: comp.name, method: "GET" });
      }
      if (imp.specifiers.some((s) => s === "useSWR")) {
        fetchPatterns.push({ url: "(via SWR)", usedIn: comp.name, method: "GET" });
      }
    }
  }

  // Determine calling pattern
  let callingPattern = "Direct fetch calls";
  if (apiUtilFile) callingPattern = `Centralized API client (${apiUtilFile})`;
  else if (httpClient === "axios") callingPattern = "Axios instance";
  else if (httpClient.includes("TanStack")) callingPattern = "TanStack Query hooks";

  // Error handling pattern
  let errorPattern = "Unknown (no consistent pattern detected)";
  if (components.some((c) => c.imports.some((i) => i.specifiers.some((s) => s.includes("toast") || s.includes("Toast"))))) {
    errorPattern = "Toast notifications on error";
  } else if (components.some((c) => c.children.some((ch) => ch.includes("Error") || ch.includes("Alert")))) {
    errorPattern = "Error boundary / alert components";
  }

  return {
    callingPattern,
    apiUtilFile,
    httpClient,
    errorPattern,
    endpoints,
    fetchPatterns: fetchPatterns.slice(0, 10),
  };
}

export function apiPatternsToMarkdown(analysis: ApiPatternAnalysis): string {
  const L: string[] = [];

  L.push("## API Patterns");
  L.push("");
  L.push(`**Client:** ${analysis.httpClient}`);
  L.push(`**Pattern:** ${analysis.callingPattern}`);
  if (analysis.apiUtilFile) L.push(`**API file:** \`${analysis.apiUtilFile}\``);
  L.push(`**Errors:** ${analysis.errorPattern}`);
  L.push("");

  if (analysis.endpoints.length > 0) {
    L.push("**Endpoints:**");
    L.push("");
    L.push("| Method | Path | File |");
    L.push("|--------|------|------|");
    for (const ep of analysis.endpoints) {
      L.push(`| ${ep.method} | \`${ep.path}\` | \`${ep.file}\` |`);
    }
    L.push("");
  }

  return L.join("\n");
}
