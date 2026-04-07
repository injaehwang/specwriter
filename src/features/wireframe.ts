/**
 * Wireframe design tool for feature specifications.
 *
 * Two modes:
 * 1. Design mode: AI creates wireframe from description → components extracted
 * 2. Analyze mode: Extract wireframe from existing page component tree
 */

export interface WireframeSpec {
  pageName: string;
  route: string;
  /** ASCII wireframe diagram */
  ascii: string;
  /** Sections extracted from wireframe */
  sections: WireframeSection[];
}

export interface WireframeSection {
  name: string;
  role: "header" | "nav" | "sidebar" | "main" | "footer" | "modal" | "form" | "list" | "card" | "section";
  description: string;
  /** Components needed for this section */
  components: string[];
  /** Position in layout */
  position: string;
}

/**
 * Build a wireframe from a structured layout description.
 * AI calls this with sections, we render ASCII + extract components.
 */
export function buildWireframe(
  pageName: string,
  route: string,
  sections: WireframeSection[],
): WireframeSpec {
  const ascii = renderAsciiFromSections(sections);
  return { pageName, route, ascii, sections };
}

/**
 * Render ASCII wireframe from sections
 */
function renderAsciiFromSections(sections: WireframeSection[]): string {
  const W = 60;
  const L: string[] = [];

  // Group sections by role for layout
  const header = sections.find((s) => s.role === "header" || s.role === "nav");
  const sidebar = sections.find((s) => s.role === "sidebar");
  const footer = sections.find((s) => s.role === "footer");
  const mainSections = sections.filter((s) =>
    s !== header && s !== sidebar && s !== footer
  );

  const hr = "─".repeat(W - 2);
  const box = (label: string, width: number) => {
    const inner = width - 4;
    const text = label.length > inner ? label.slice(0, inner) : label;
    const pad = inner - text.length;
    return [
      `┌${"─".repeat(width - 2)}┐`,
      `│ ${text}${" ".repeat(Math.max(0, pad))} │`,
      `└${"─".repeat(width - 2)}┘`,
    ];
  };

  // Top border
  L.push(`┌${hr}┐`);

  // Header
  if (header) {
    const label = `[${header.name}] ${header.components.join(" | ")}`;
    L.push(`│ ${label}${" ".repeat(Math.max(0, W - 3 - label.length))}│`);
    L.push(`├${hr}┤`);
  }

  // Body: sidebar + main
  if (sidebar) {
    const sideW = 16;
    const mainW = W - sideW - 3;
    const sideLabel = `[${sidebar.name}]`;

    // Render each main section
    const mainLines: string[] = [];
    for (const section of mainSections) {
      const compStr = section.components.length > 0
        ? section.components.map((c) => `<${c}>`).join("  ")
        : section.description;

      mainLines.push(`  [${section.name}]`);
      mainLines.push(`  ${compStr}`);
      mainLines.push("");
    }

    const totalLines = Math.max(mainLines.length, 4);
    for (let i = 0; i < totalLines; i++) {
      const sideContent = i === 0 ? sideLabel : i === 1 ? sidebar.components.map((c) => `<${c}>`).join("\n") : "";
      const sidePart = (sideContent || "").slice(0, sideW - 2).padEnd(sideW - 2);
      const mainPart = (mainLines[i] || "").slice(0, mainW - 2).padEnd(mainW - 2);
      L.push(`│${sidePart} │${mainPart} │`);
    }
  } else {
    // No sidebar — render main sections stacked
    for (const section of mainSections) {
      const compStr = section.components.length > 0
        ? section.components.map((c) => `<${c}>`).join("  ")
        : section.description;
      const label = `[${section.name}]`;

      L.push(`│ ${label}${" ".repeat(Math.max(0, W - 3 - label.length))}│`);
      const contentLine = `  ${compStr}`;
      L.push(`│ ${contentLine}${" ".repeat(Math.max(0, W - 3 - contentLine.length))}│`);

      if (section !== mainSections[mainSections.length - 1]) {
        L.push(`├${hr}┤`);
      }
    }
  }

  // Footer
  if (footer) {
    L.push(`├${hr}┤`);
    const label = `[${footer.name}] ${footer.components.join(" | ")}`;
    L.push(`│ ${label}${" ".repeat(Math.max(0, W - 3 - label.length))}│`);
  }

  L.push(`└${hr}┘`);

  return L.join("\n");
}

/**
 * Extract component list from wireframe sections (for feature spec)
 */
export function extractComponentsFromWireframe(
  wireframe: WireframeSpec
): { name: string; role: string; isNew: boolean }[] {
  const components: { name: string; role: string; isNew: boolean }[] = [];
  const seen = new Set<string>();

  for (const section of wireframe.sections) {
    for (const comp of section.components) {
      if (!seen.has(comp)) {
        seen.add(comp);
        components.push({
          name: comp,
          role: section.role,
          isNew: true,
        });
      }
    }
  }

  return components;
}

/**
 * Generate wireframe markdown for feature spec
 */
export function wireframeToMarkdown(wireframe: WireframeSpec): string {
  const L: string[] = [];

  L.push(`## Wireframe: ${wireframe.pageName}`);
  L.push(`Route: \`${wireframe.route}\``);
  L.push("");
  L.push("```");
  L.push(wireframe.ascii);
  L.push("```");
  L.push("");

  if (wireframe.sections.length > 0) {
    L.push("### Sections");
    L.push("");
    for (const section of wireframe.sections) {
      const comps = section.components.length > 0
        ? ` → ${section.components.join(", ")}`
        : "";
      L.push(`- **${section.name}** [${section.role}]: ${section.description}${comps}`);
    }
    L.push("");
  }

  return L.join("\n");
}
