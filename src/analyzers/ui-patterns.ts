import { ComponentInfo } from "../types/component.js";

export interface UiPattern {
  name: string;
  description: string;
  components: ComponentUsage[];
  hooks: string[];
  usage: string;
}

interface ComponentUsage {
  name: string;
  file: string;
  props: string[];
  usedByCount: number;
}

/**
 * Detect UI patterns from ACTUAL component analysis — not hardcoded categories.
 *
 * Strategy:
 * 1. Build usage graph: who uses whom
 * 2. Find components used by 3+ parents → these are shared UI primitives
 * 3. Group related components by co-occurrence (used together in same parent)
 * 4. Name patterns from component relationships, not string matching
 */
export function detectUiPatterns(components: ComponentInfo[]): UiPattern[] {
  // Build usage map: componentName → list of parents using it
  const usedBy = new Map<string, Set<string>>();
  const compMap = new Map<string, ComponentInfo>();
  for (const c of components) {
    compMap.set(c.name, c);
  }

  for (const comp of components) {
    for (const childName of comp.children) {
      if (!usedBy.has(childName)) usedBy.set(childName, new Set());
      usedBy.get(childName)!.add(comp.name);
    }
    for (const imp of comp.imports) {
      for (const spec of imp.specifiers) {
        if (/^[A-Z]/.test(spec) && spec !== comp.name && compMap.has(spec)) {
          if (!usedBy.has(spec)) usedBy.set(spec, new Set());
          usedBy.get(spec)!.add(comp.name);
        }
      }
    }
  }

  const patterns: UiPattern[] = [];

  // ─── 1. Find shared components (used by 2+ parents) ───
  const sharedComps = Array.from(usedBy.entries())
    .filter(([, parents]) => parents.size >= 2)
    .sort((a, b) => b[1].size - a[1].size);

  if (sharedComps.length > 0) {
    const sharedUsages: ComponentUsage[] = sharedComps
      .slice(0, 10)
      .map(([name, parents]) => {
        const comp = compMap.get(name);
        return {
          name,
          file: comp?.filePath || "",
          props: comp?.props.map((p) => p.name) || [],
          usedByCount: parents.size,
        };
      });

    patterns.push({
      name: "Shared Components",
      description: `${sharedComps.length} components reused across the project`,
      components: sharedUsages,
      hooks: [],
      usage: sharedUsages.slice(0, 3).map((c) => {
        const propsStr = c.props.length > 0
          ? " " + c.props.slice(0, 2).map((p) => `${p}={...}`).join(" ")
          : "";
        return `<${c.name}${propsStr} /> — used by ${c.usedByCount} components`;
      }).join("\n"),
    });
  }

  // ─── 2. Find co-occurring component groups ───
  // Components that are frequently used together in the same parent
  const coOccurrence = new Map<string, Map<string, number>>();
  for (const comp of components) {
    const childList = [...comp.children];
    for (let i = 0; i < childList.length; i++) {
      for (let j = i + 1; j < childList.length; j++) {
        const a = childList[i];
        const b = childList[j];
        if (!compMap.has(a) || !compMap.has(b)) continue;
        const key = [a, b].sort().join("::");
        if (!coOccurrence.has(key)) coOccurrence.set(key, new Map());
        const pair = coOccurrence.get(key)!;
        pair.set(comp.name, (pair.get(comp.name) || 0) + 1);
      }
    }
  }

  // Find groups with high co-occurrence
  const frequentPairs = Array.from(coOccurrence.entries())
    .filter(([, parents]) => parents.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5);

  for (const [pair, parents] of frequentPairs) {
    const [a, b] = pair.split("::");
    const compA = compMap.get(a);
    const compB = compMap.get(b);
    if (!compA || !compB) continue;

    patterns.push({
      name: `${a} + ${b}`,
      description: `Always used together (in ${parents.size} components)`,
      components: [
        { name: a, file: compA.filePath, props: compA.props.map((p) => p.name), usedByCount: usedBy.get(a)?.size || 0 },
        { name: b, file: compB.filePath, props: compB.props.map((p) => p.name), usedByCount: usedBy.get(b)?.size || 0 },
      ],
      hooks: [],
      usage: `<${a} />\n<${b} />`,
    });
  }

  // ─── 3. Find hook + component pairings ───
  const hooks = components.filter((c) => c.type === "hook" || c.name.startsWith("use"));
  for (const hook of hooks) {
    // Find components that import this hook
    const users = components.filter((c) =>
      c.imports.some((imp) => imp.specifiers.includes(hook.name)) ||
      c.children.includes(hook.name)
    );
    if (users.length >= 2) {
      patterns.push({
        name: `${hook.name} pattern`,
        description: `Custom hook used by ${users.length} components`,
        components: users.slice(0, 5).map((u) => ({
          name: u.name,
          file: u.filePath,
          props: [],
          usedByCount: 0,
        })),
        hooks: [hook.name],
        usage: `const result = ${hook.name}()`,
      });
    }
  }

  // ─── 4. Detect layout patterns from actual component tree ───
  const layouts = components.filter((c) => c.type === "layout");
  if (layouts.length > 0) {
    const layoutChildren: ComponentUsage[] = [];
    for (const layout of layouts) {
      for (const childName of layout.children) {
        const child = compMap.get(childName);
        if (child) {
          layoutChildren.push({
            name: childName,
            file: child.filePath,
            props: child.props.map((p) => p.name),
            usedByCount: usedBy.get(childName)?.size || 0,
          });
        }
      }
    }
    if (layoutChildren.length > 0) {
      patterns.push({
        name: "Layout Structure",
        description: `${layouts.map((l) => l.name).join(", ")} wraps: ${layoutChildren.map((c) => c.name).join(", ")}`,
        components: layoutChildren,
        hooks: [],
        usage: layouts.map((l) => {
          const kids = l.children.slice(0, 4).map((c) => `<${c} />`).join("\n  ");
          return `<${l.name}>\n  ${kids}\n</${l.name}>`;
        }).join("\n"),
      });
    }
  }

  // ─── 5. Detect wrapper/provider patterns ───
  const providers = components.filter((c) =>
    c.type === "provider" || c.name.endsWith("Provider") || c.name.endsWith("Context")
  );
  if (providers.length > 0) {
    patterns.push({
      name: "Providers / Context",
      description: `${providers.length} context provider(s) wrapping the app`,
      components: providers.map((p) => ({
        name: p.name,
        file: p.filePath,
        props: p.props.map((pr) => pr.name),
        usedByCount: usedBy.get(p.name)?.size || 0,
      })),
      hooks: [],
      usage: providers.map((p) => `<${p.name}>...children...</${p.name}>`).join("\n"),
    });
  }

  return patterns;
}

export function uiPatternsToMarkdown(patterns: UiPattern[]): string {
  if (patterns.length === 0) return "";

  const L: string[] = [];
  L.push("## Shared Components");
  L.push("");

  for (const p of patterns) {
    L.push(`### ${p.name}`);
    L.push(p.description);
    L.push("");

    if (p.usage) {
      L.push("```tsx");
      L.push(p.usage);
      L.push("```");
      L.push("");
    }

    if (p.components.length > 0) {
      for (const c of p.components.slice(0, 5)) {
        const propsStr = c.props.length > 0 ? ` (${c.props.slice(0, 4).join(", ")})` : "";
        const usageStr = c.usedByCount > 0 ? ` — used by ${c.usedByCount}` : "";
        L.push(`- \`${c.name}\` \`${c.file}\`${propsStr}${usageStr}`);
      }
      L.push("");
    }

    if (p.hooks.length > 0) {
      L.push(`Hooks: ${p.hooks.map((h) => `\`${h}\``).join(", ")}`);
      L.push("");
    }
  }

  return L.join("\n");
}
