import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { RouteInfo } from "../../types/page.js";

/**
 * Extract routes from Next.js App Router (app/ directory)
 */
export async function extractAppRouterRoutes(
  projectRoot: string
): Promise<RouteInfo[]> {
  const appDir = path.join(projectRoot, "app");

  try {
    await fs.access(appDir);
  } catch {
    return [];
  }

  const pageFiles = await glob("**/page.{tsx,jsx,ts,js}", {
    cwd: appDir,
    posix: true,
  });

  const routes: RouteInfo[] = [];

  for (const file of pageFiles) {
    const segments = file.split("/").slice(0, -1); // Remove page.tsx
    const routePath = "/" + segments
      .filter((s) => !s.startsWith("(")) // Remove route groups
      .map((s) => {
        if (s.startsWith("[...") && s.endsWith("]")) return `*`; // Catch-all
        if (s.startsWith("[") && s.endsWith("]")) return `:${s.slice(1, -1)}`; // Dynamic
        return s;
      })
      .join("/");

    const params = segments
      .filter((s) => s.startsWith("[") && s.endsWith("]"))
      .map((s) => s.replace(/^\[\.{0,3}/, "").replace(/\]$/, ""));

    routes.push({
      path: routePath || "/",
      filePath: path.join("app", file),
      name: inferRouteName(routePath),
      layout: await findLayout(appDir, segments),
      isApiRoute: false,
      isDynamic: params.length > 0,
      params,
      children: [],
      metadata: {
        title: null,
        description: null,
        isProtected: false,
        middleware: [],
      },
    });
  }

  // Extract API routes
  const apiFiles = await glob("**/route.{tsx,jsx,ts,js}", {
    cwd: appDir,
    posix: true,
  });

  for (const file of apiFiles) {
    const segments = file.split("/").slice(0, -1);
    const routePath = "/" + segments
      .filter((s) => !s.startsWith("("))
      .map((s) => {
        if (s.startsWith("[") && s.endsWith("]")) return `:${s.slice(1, -1)}`;
        return s;
      })
      .join("/");

    routes.push({
      path: routePath,
      filePath: path.join("app", file),
      name: inferRouteName(routePath) + " (API)",
      layout: null,
      isApiRoute: true,
      isDynamic: routePath.includes(":"),
      params: [],
      children: [],
      metadata: {
        title: null,
        description: null,
        isProtected: false,
        middleware: [],
      },
    });
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Extract routes from Next.js Pages Router (pages/ directory)
 */
export async function extractPagesRouterRoutes(
  projectRoot: string
): Promise<RouteInfo[]> {
  const pagesDir = path.join(projectRoot, "pages");

  try {
    await fs.access(pagesDir);
  } catch {
    return [];
  }

  const pageFiles = await glob("**/*.{tsx,jsx,ts,js}", {
    cwd: pagesDir,
    posix: true,
    ignore: ["_app.*", "_document.*", "_error.*", "api/**"],
  });

  const routes: RouteInfo[] = [];

  for (const file of pageFiles) {
    const segments = file.replace(/\.[jt]sx?$/, "").split("/");
    const lastSegment = segments[segments.length - 1];

    // Handle index routes
    if (lastSegment === "index") {
      segments.pop();
    }

    const routePath = "/" + segments
      .map((s) => {
        if (s.startsWith("[...") && s.endsWith("]")) return `*`;
        if (s.startsWith("[") && s.endsWith("]")) return `:${s.slice(1, -1)}`;
        return s;
      })
      .join("/");

    routes.push({
      path: routePath || "/",
      filePath: path.join("pages", file),
      name: inferRouteName(routePath || "/"),
      layout: null,
      isApiRoute: false,
      isDynamic: routePath.includes(":"),
      params: segments
        .filter((s) => s.startsWith("["))
        .map((s) => s.replace(/^\[\.{0,3}/, "").replace(/\]$/, "")),
      children: [],
      metadata: {
        title: null,
        description: null,
        isProtected: false,
        middleware: [],
      },
    });
  }

  // Extract API routes from pages/api
  const apiFiles = await glob("api/**/*.{tsx,jsx,ts,js}", {
    cwd: pagesDir,
    posix: true,
  });

  for (const file of apiFiles) {
    const routePath = "/" + file.replace(/\.[jt]sx?$/, "").replace(/\/index$/, "");
    routes.push({
      path: routePath,
      filePath: path.join("pages", file),
      name: inferRouteName(routePath) + " (API)",
      layout: null,
      isApiRoute: true,
      isDynamic: routePath.includes("["),
      params: [],
      children: [],
      metadata: {
        title: null,
        description: null,
        isProtected: false,
        middleware: [],
      },
    });
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

async function findLayout(appDir: string, segments: string[]): Promise<string | null> {
  // Walk up from the page's directory to find the nearest layout
  for (let i = segments.length; i >= 0; i--) {
    const dir = path.join(appDir, ...segments.slice(0, i));
    const layoutExtensions = ["tsx", "jsx", "ts", "js"];
    for (const ext of layoutExtensions) {
      try {
        await fs.access(path.join(dir, `layout.${ext}`));
        return path.join("app", ...segments.slice(0, i), `layout.${ext}`);
      } catch {
        // Not found
      }
    }
  }
  return null;
}

function inferRouteName(routePath: string): string {
  if (routePath === "/" || routePath === "") return "Home";
  const parts = routePath.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last.startsWith(":")) return parts[parts.length - 2] || "Dynamic";
  return last.charAt(0).toUpperCase() + last.slice(1);
}
