import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { ComponentInfo } from "../types/component.js";
import { writeJson, writeMarkdown } from "./index.js";

export async function generateComponentSpecs(
  spec: SpecOutput,
  outputDir: string,
  config: AnalysisConfig
): Promise<void> {
  const componentsDir = path.join(outputDir, "components");

  // Component index
  if (config.format === "json" || config.format === "both") {
    await writeJson(path.join(componentsDir, "_index.json"), {
      components: spec.components.map((c) => ({
        name: c.name,
        type: c.type,
        filePath: c.filePath,
        propsCount: c.props.length,
        stateCount: c.state.length,
        childrenCount: c.children.length,
      })),
      graph: spec.componentGraph,
    });
  }

  if (config.format === "md" || config.format === "both") {
    await writeMarkdown(
      path.join(componentsDir, "_index.md"),
      buildComponentIndexMarkdown(spec)
    );
  }

  // Individual component specs
  for (const comp of spec.components) {
    const safeName = sanitizeFileName(comp.name);

    if (config.format === "json" || config.format === "both") {
      await writeJson(path.join(componentsDir, `${safeName}.json`), comp);
    }

    if (config.format === "md" || config.format === "both") {
      await writeMarkdown(
        path.join(componentsDir, `${safeName}.md`),
        buildComponentMarkdown(comp)
      );
    }
  }
}

function buildComponentIndexMarkdown(spec: SpecOutput): string {
  const lines: string[] = [];

  lines.push("# Component Registry");
  lines.push("");
  lines.push(`Total: ${spec.components.length} components`);
  lines.push("");

  // Group by type
  const groups = new Map<string, ComponentInfo[]>();
  for (const comp of spec.components) {
    const list = groups.get(comp.type) || [];
    list.push(comp);
    groups.set(comp.type, list);
  }

  for (const [type, comps] of groups) {
    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
    lines.push("");
    lines.push("| Name | File | Props | State | Children |");
    lines.push("|------|------|-------|-------|----------|");
    for (const comp of comps) {
      lines.push(
        `| ${comp.name} | ${comp.filePath} | ${comp.props.length} | ${comp.state.length} | ${comp.children.length} |`
      );
    }
    lines.push("");
  }

  // Component dependency graph
  if (spec.componentGraph.edges.length > 0) {
    lines.push("## Dependency Graph");
    lines.push("");
    lines.push("```");
    for (const edge of spec.componentGraph.edges) {
      lines.push(`${edge.from} ──${edge.relation}──> ${edge.to}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function buildComponentMarkdown(comp: ComponentInfo): string {
  const lines: string[] = [];

  lines.push(`# ${comp.name}`);
  lines.push("");
  lines.push(`**Type:** ${comp.type}`);
  lines.push(`**File:** \`${comp.filePath}\``);
  lines.push(`**Export:** ${comp.exportType}`);
  if (comp.isClientComponent) lines.push("**Client Component**");
  if (comp.isServerComponent) lines.push("**Server Component**");
  lines.push("");

  // Props
  if (comp.props.length > 0) {
    lines.push("## Props");
    lines.push("");
    lines.push("| Name | Type | Required | Default |");
    lines.push("|------|------|----------|---------|");
    for (const prop of comp.props) {
      const def = prop.defaultValue || "-";
      lines.push(
        `| \`${prop.name}\` | \`${prop.type === "unknown" ? "-" : prop.type}\` | ${prop.required ? "Yes" : "No"} | ${def} |`
      );
    }
    lines.push("");
  }

  // State
  if (comp.state.length > 0) {
    lines.push("## State");
    lines.push("");
    lines.push("| Name | Type | Source | Initial |");
    lines.push("|------|------|--------|---------|");
    for (const s of comp.state) {
      lines.push(
        `| \`${s.name}\` | \`${s.type}\` | ${s.source} | ${s.initialValue || "-"} |`
      );
    }
    lines.push("");
  }

  // Events
  if (comp.events.length > 0) {
    lines.push("## Events");
    lines.push("");
    for (const event of comp.events) {
      lines.push(`- **${event.name}**: ${event.payload}`);
    }
    lines.push("");
  }

  // Slots
  if (comp.slots.length > 0) {
    lines.push("## Slots");
    lines.push("");
    for (const slot of comp.slots) {
      lines.push(`- **${slot.name}**${slot.description ? `: ${slot.description}` : ""}`);
    }
    lines.push("");
  }

  // Children (used components)
  if (comp.children.length > 0) {
    lines.push("## Used Components");
    lines.push("");
    for (const child of comp.children) {
      lines.push(`- ${child}`);
    }
    lines.push("");
  }

  // Imports
  if (comp.imports.length > 0) {
    lines.push("## Dependencies");
    lines.push("");
    const external = comp.imports.filter((i) => !i.source.startsWith(".") && !i.source.startsWith("@/"));
    const internal = comp.imports.filter((i) => i.source.startsWith(".") || i.source.startsWith("@/"));

    if (external.length > 0) {
      lines.push("**External:**");
      for (const imp of external) {
        lines.push(`- \`${imp.source}\`: ${imp.specifiers.join(", ")}`);
      }
      lines.push("");
    }

    if (internal.length > 0) {
      lines.push("**Internal:**");
      for (const imp of internal) {
        lines.push(`- \`${imp.source}\`: ${imp.specifiers.join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
