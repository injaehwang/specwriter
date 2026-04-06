import fs from "node:fs/promises";
import path from "node:path";
import { ComponentInfo } from "../types/component.js";
import { RouteInfo } from "../types/page.js";

export interface PageTemplate {
  /** How pages are organized in this project */
  filePattern: string;
  /** Common imports shared across pages */
  commonImports: string[];
  /** Layout chain: what wraps every page */
  layoutChain: string[];
  /** Whether pages are server or client by default */
  defaultRenderMode: "server" | "client" | "mixed";
  /** Common patterns found across pages */
  patterns: string[];
  /** Generated template code */
  templateCode: string;
}

export function analyzePageTemplate(
  components: ComponentInfo[],
  routes: RouteInfo[],
  frameworkId: string,
): PageTemplate {
  const pages = components.filter((c) => c.type === "page");
  const layouts = components.filter((c) => c.type === "layout");

  // Detect file pattern
  let filePattern = "Unknown";
  if (pages.length > 0) {
    const firstPage = pages[0].filePath;
    if (firstPage.includes("/app/")) filePattern = "app/[name]/page.tsx (App Router)";
    else if (firstPage.includes("/pages/")) filePattern = "pages/[name].tsx (Pages Router)";
    else if (firstPage.endsWith(".vue")) filePattern = "pages/[name].vue (File-based routing)";
    else filePattern = `${path.dirname(firstPage)}/[name]${path.extname(firstPage)}`;
  }

  // Find common imports across pages
  const importFreq = new Map<string, number>();
  for (const page of pages) {
    for (const imp of page.imports) {
      const key = `${imp.source}:${imp.specifiers.join(",")}`;
      importFreq.set(key, (importFreq.get(key) || 0) + 1);
    }
  }
  const commonImports = Array.from(importFreq.entries())
    .filter(([, count]) => count >= Math.max(2, pages.length * 0.5))
    .map(([key]) => {
      const [source, specs] = key.split(":");
      return specs ? `import { ${specs} } from "${source}"` : `import "${source}"`;
    })
    .slice(0, 8);

  // Layout chain
  const layoutChain = layouts.map((l) => `${l.name} (${l.filePath})`);

  // Default render mode
  const clientPages = pages.filter((p) => p.isClientComponent).length;
  const serverPages = pages.filter((p) => p.isServerComponent).length;
  let defaultRenderMode: "server" | "client" | "mixed" = "client";
  if (serverPages > clientPages) defaultRenderMode = "server";
  else if (serverPages > 0 && clientPages > 0) defaultRenderMode = "mixed";

  // Common patterns
  const patterns: string[] = [];
  if (defaultRenderMode === "server") patterns.push("Pages are server components by default");
  if (defaultRenderMode === "client") patterns.push("Pages use 'use client' directive");
  if (commonImports.length > 0) patterns.push(`${commonImports.length} common imports shared across pages`);
  if (layouts.length > 0) patterns.push(`${layouts.length} layout(s) wrap pages: ${layouts.map((l) => l.name).join(", ")}`);

  // Detect metadata pattern
  const hasMetadata = pages.some((p) =>
    p.imports.some((i) => i.specifiers.includes("Metadata") || i.specifiers.includes("generateMetadata"))
  );
  if (hasMetadata) patterns.push("Pages export metadata (SEO)");

  // Generate template
  const templateCode = generateTemplate(frameworkId, defaultRenderMode, commonImports, hasMetadata);

  return {
    filePattern,
    commonImports,
    layoutChain,
    defaultRenderMode,
    patterns,
    templateCode,
  };
}

function generateTemplate(
  frameworkId: string,
  renderMode: string,
  commonImports: string[],
  hasMetadata: boolean,
): string {
  if (frameworkId === "nextjs") {
    const lines: string[] = [];
    if (renderMode === "client") lines.push('"use client";\n');
    if (hasMetadata && renderMode !== "client") {
      lines.push('import { Metadata } from "next";\n');
      lines.push("export const metadata: Metadata = {");
      lines.push('  title: "Page Title",');
      lines.push("};\n");
    }
    for (const imp of commonImports.slice(0, 3)) {
      lines.push(imp + ";");
    }
    if (commonImports.length > 0) lines.push("");
    if (renderMode === "server") {
      lines.push("export default async function PageName() {");
      lines.push("  // Fetch data here (server component)");
      lines.push("  return <div>Page content</div>;");
    } else {
      lines.push("export default function PageName() {");
      lines.push("  return <div>Page content</div>;");
    }
    lines.push("}");
    return lines.join("\n");
  }

  if (frameworkId === "vue" || frameworkId === "nuxt") {
    return [
      "<script setup lang=\"ts\">",
      "// imports here",
      "</script>",
      "",
      "<template>",
      "  <div>Page content</div>",
      "</template>",
    ].join("\n");
  }

  // Generic React
  return [
    renderMode === "client" ? '"use client";\n' : "",
    "export default function PageName() {",
    "  return <div>Page content</div>;",
    "}",
  ].filter(Boolean).join("\n");
}

export function pageTemplateToMarkdown(template: PageTemplate): string {
  const L: string[] = [];

  L.push("## New Page Guide");
  L.push("");
  L.push(`**File:** \`${template.filePattern}\``);
  L.push(`**Default:** ${template.defaultRenderMode} component`);
  L.push("");

  if (template.layoutChain.length > 0) {
    L.push(`**Layouts:** ${template.layoutChain.join(" → ")}`);
    L.push("");
  }

  if (template.patterns.length > 0) {
    L.push("**Patterns:**");
    for (const p of template.patterns) {
      L.push(`- ${p}`);
    }
    L.push("");
  }

  L.push("**Template:**");
  L.push("```tsx");
  L.push(template.templateCode);
  L.push("```");
  L.push("");

  return L.join("\n");
}
