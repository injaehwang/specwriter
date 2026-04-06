import { ComponentInfo } from "../types/component.js";

/**
 * Component usage guide with real usage examples from the codebase
 */
export interface ComponentUsageGuide {
  name: string;
  filePath: string;
  /** How to use this component — auto-generated JSX example */
  usage: string;
  /** Variants detected from union type props (e.g. "primary" | "secondary") */
  variants: { prop: string; values: string[] }[];
  /** Real usage sites: where this component is actually used */
  usageSites: { file: string; snippet: string }[];
  /** What this component typically wraps (children pattern) */
  childrenPattern: string | null;
  /** Warnings/notes about usage */
  notes: string[];
}

/**
 * Analyze how components are used across the codebase
 */
export function analyzeComponentUsage(components: ComponentInfo[]): ComponentUsageGuide[] {
  // Build parent-child map: for each component, who uses it
  const usedBy = new Map<string, { parent: ComponentInfo; }[]>();
  for (const comp of components) {
    for (const childName of comp.children) {
      if (!usedBy.has(childName)) usedBy.set(childName, []);
      usedBy.get(childName)!.push({ parent: comp });
    }
    // Also from imports
    for (const imp of comp.imports) {
      for (const spec of imp.specifiers) {
        if (/^[A-Z]/.test(spec) && spec !== comp.name) {
          if (!usedBy.has(spec)) usedBy.set(spec, []);
          const existing = usedBy.get(spec)!;
          if (!existing.some((e) => e.parent.name === comp.name)) {
            existing.push({ parent: comp });
          }
        }
      }
    }
  }

  const guides: ComponentUsageGuide[] = [];

  for (const comp of components) {
    if (comp.type === "utility" || comp.type === "hook") continue;

    // Generate usage example from props
    const usage = generateUsageExample(comp);

    // Detect variants from union-type props
    const variants = detectVariants(comp);

    // Find real usage sites
    const sites = usedBy.get(comp.name) || [];
    const usageSites = sites.slice(0, 5).map((site) => ({
      file: site.parent.filePath,
      snippet: `Used in ${site.parent.name}`,
    }));

    // Detect children pattern
    const childrenPattern = detectChildrenPattern(comp);

    // Generate notes
    const notes = generateNotes(comp, sites.length);

    guides.push({
      name: comp.name,
      filePath: comp.filePath,
      usage,
      variants,
      usageSites,
      childrenPattern,
      notes,
    });
  }

  return guides;
}

function generateUsageExample(comp: ComponentInfo): string {
  const props = comp.props
    .filter((p) => p.required)
    .map((p) => {
      if (p.type === "string" || p.type.includes("string")) return `${p.name}="value"`;
      if (p.type === "number" || p.type.includes("number")) return `${p.name}={0}`;
      if (p.type === "boolean" || p.type.includes("boolean")) return `${p.name}`;
      if (p.type.includes("=>") || p.type.includes("Function")) return `${p.name}={handler}`;
      if (p.type.includes("[]")) return `${p.name}={[]}`;
      return `${p.name}={${p.name}}`;
    })
    .join(" ");

  const hasChildren = comp.children.length > 0 ||
    comp.props.some((p) => p.name === "children");

  if (hasChildren) {
    return `<${comp.name}${props ? " " + props : ""}>...</${comp.name}>`;
  }
  return `<${comp.name}${props ? " " + props : ""} />`;
}

function detectVariants(comp: ComponentInfo): { prop: string; values: string[] }[] {
  const variants: { prop: string; values: string[] }[] = [];

  for (const prop of comp.props) {
    // Check for union types: "primary" | "secondary" | "danger"
    if (prop.type.includes("|") && prop.type.includes('"')) {
      const values = prop.type
        .split("|")
        .map((v) => v.trim().replace(/"/g, "").replace(/'/g, ""))
        .filter((v) => v && !v.includes("undefined") && !v.includes("null"));
      if (values.length >= 2) {
        variants.push({ prop: prop.name, values });
      }
    }
  }

  return variants;
}

function detectChildrenPattern(comp: ComponentInfo): string | null {
  const childrenProp = comp.props.find((p) => p.name === "children");
  if (childrenProp) {
    if (childrenProp.type.includes("ReactNode")) return "Any React content";
    if (childrenProp.type.includes("string")) return "Text content";
    return "React children";
  }
  if (comp.children.length > 0) {
    return `Renders: ${comp.children.slice(0, 5).join(", ")}`;
  }
  return null;
}

function generateNotes(comp: ComponentInfo, usageCount: number): string[] {
  const notes: string[] = [];

  if (comp.isClientComponent) notes.push("Client component ('use client')");
  if (comp.isServerComponent) notes.push("Server component (no 'use client')");
  if (usageCount === 0) notes.push("Not used by other components (possibly a page or entry point)");
  if (usageCount >= 5) notes.push(`Widely used (${usageCount} usage sites)`);

  const requiredProps = comp.props.filter((p) => p.required);
  if (requiredProps.length > 3) {
    notes.push(`${requiredProps.length} required props — consider checking interface before use`);
  }

  return notes;
}

/**
 * Generate markdown for component usage guides
 */
export function usageGuideToMarkdown(guide: ComponentUsageGuide): string {
  const L: string[] = [];

  L.push(`## ${guide.name}`);
  L.push("");
  L.push("```tsx");
  L.push(guide.usage);
  L.push("```");
  L.push("");

  if (guide.variants.length > 0) {
    for (const v of guide.variants) {
      L.push(`**${v.prop}:** ${v.values.map((val) => `\`${val}\``).join(" | ")}`);
    }
    L.push("");
  }

  if (guide.childrenPattern) {
    L.push(`**Children:** ${guide.childrenPattern}`);
    L.push("");
  }

  if (guide.usageSites.length > 0) {
    L.push("**Used in:**");
    for (const site of guide.usageSites) {
      L.push(`- \`${site.file}\` — ${site.snippet}`);
    }
    L.push("");
  }

  if (guide.notes.length > 0) {
    for (const note of guide.notes) {
      L.push(`> ${note}`);
    }
    L.push("");
  }

  return L.join("\n");
}
