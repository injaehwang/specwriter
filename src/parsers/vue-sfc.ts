import { ComponentInfo, PropInfo, StateInfo, ImportInfo } from "../types/component.js";

/**
 * Parse Vue Single File Component (.vue)
 * Uses regex-based parsing to avoid hard dependency on @vue/compiler-sfc
 */
export function extractVueComponent(
  filePath: string,
  content: string
): ComponentInfo | null {
  const name = inferNameFromVuePath(filePath);

  const scriptContent = extractBlock(content, "script");
  const templateContent = extractBlock(content, "template");
  const isSetup = content.includes("<script setup") || content.includes("setup()");

  const props = isSetup
    ? extractSetupProps(scriptContent)
    : extractOptionsProps(scriptContent);

  const state = isSetup
    ? extractSetupState(scriptContent)
    : extractOptionsState(scriptContent);

  const imports = extractVueImports(scriptContent);
  const children = extractVueChildren(templateContent);

  return {
    name,
    filePath,
    type: "component",
    props,
    state,
    events: [],
    slots: extractSlots(templateContent),
    imports,
    children,
    exportType: "default",
    isClientComponent: true,
    isServerComponent: false,
    description: "",
    loc: { start: 1, end: content.split("\n").length },
  };
}

function extractBlock(content: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = content.match(regex);
  return match ? match[1] : "";
}

function extractSetupProps(script: string): PropInfo[] {
  const props: PropInfo[] = [];

  // defineProps<{ propName: type }>()
  const genericMatch = script.match(/defineProps<\{([^}]+)\}>/);
  if (genericMatch) {
    return parsePropsFromTypeBody(genericMatch[1]);
  }

  // defineProps({ propName: { type: String, required: true } })
  const objectMatch = script.match(/defineProps\(\{([^)]+)\}\)/s);
  if (objectMatch) {
    return parsePropsFromObjectBody(objectMatch[1]);
  }

  return props;
}

function extractOptionsProps(script: string): PropInfo[] {
  const propsMatch = script.match(/props\s*:\s*\{([^}]+)\}/s);
  if (propsMatch) {
    return parsePropsFromObjectBody(propsMatch[1]);
  }
  return [];
}

function parsePropsFromTypeBody(body: string): PropInfo[] {
  const props: PropInfo[] = [];
  const lines = body.split(/[;\n]/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\w+)(\?)?:\s*(.+)$/);
    if (match) {
      props.push({
        name: match[1],
        type: match[3].trim(),
        required: !match[2],
        defaultValue: null,
        description: "",
      });
    }
  }
  return props;
}

function parsePropsFromObjectBody(body: string): PropInfo[] {
  const props: PropInfo[] = [];
  const entries = body.split(",").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const simpleMatch = entry.match(/^(\w+):\s*(\w+)$/);
    if (simpleMatch) {
      props.push({
        name: simpleMatch[1],
        type: simpleMatch[2].toLowerCase(),
        required: false,
        defaultValue: null,
        description: "",
      });
    } else {
      const nameMatch = entry.match(/^(\w+)/);
      if (nameMatch) {
        const required = entry.includes("required: true");
        props.push({
          name: nameMatch[1],
          type: "unknown",
          required,
          defaultValue: null,
          description: "",
        });
      }
    }
  }
  return props;
}

function extractSetupState(script: string): StateInfo[] {
  const states: StateInfo[] = [];

  // ref()
  const refRegex = /const\s+(\w+)\s*=\s*ref(?:<([^>]+)>)?\(([^)]*)\)/g;
  let match;
  while ((match = refRegex.exec(script)) !== null) {
    states.push({
      name: match[1],
      type: match[2] || "unknown",
      initialValue: match[3] || null,
      setter: null,
      source: "ref",
    });
  }

  // reactive()
  const reactiveRegex = /const\s+(\w+)\s*=\s*reactive(?:<([^>]+)>)?\(/g;
  while ((match = reactiveRegex.exec(script)) !== null) {
    states.push({
      name: match[1],
      type: match[2] || "object",
      initialValue: null,
      setter: null,
      source: "reactive",
    });
  }

  return states;
}

function extractOptionsState(script: string): StateInfo[] {
  // Simplified: look for data() return properties
  const states: StateInfo[] = [];
  const dataMatch = script.match(/data\s*\(\)\s*\{[\s\S]*?return\s*\{([^}]+)\}/);
  if (dataMatch) {
    const entries = dataMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      const nameMatch = entry.match(/^(\w+)/);
      if (nameMatch) {
        states.push({
          name: nameMatch[1],
          type: "unknown",
          initialValue: null,
          setter: null,
          source: "other",
        });
      }
    }
  }
  return states;
}

function extractVueImports(script: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const importRegex = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\}\s*)?from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(script)) !== null) {
    const specifiers = [
      ...(match[1] ? [match[1]] : []),
      ...(match[2] ? match[2].split(",").map((s) => s.trim()).filter(Boolean) : []),
    ];
    imports.push({
      source: match[3],
      specifiers,
      isDefault: !!match[1],
      isType: false,
    });
  }
  return imports;
}

function extractVueChildren(template: string): string[] {
  const children = new Set<string>();
  const regex = /<([A-Z][a-zA-Z0-9]*)/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    children.add(match[1]);
  }
  // Also handle kebab-case components
  const kebabRegex = /<([a-z]+-[a-z-]+)/g;
  while ((match = kebabRegex.exec(template)) !== null) {
    // Convert kebab-case to PascalCase
    const pascal = match[1]
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    children.add(pascal);
  }
  return Array.from(children);
}

function extractSlots(template: string) {
  const slots: { name: string; props: PropInfo[]; description: string }[] = [];
  const regex = /<slot\s*(?:name="([^"]+)")?\s*[/]?>/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    slots.push({
      name: match[1] || "default",
      props: [],
      description: "",
    });
  }
  return slots;
}

function inferNameFromVuePath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1];
  if (fileName === "index.vue") {
    return parts[parts.length - 2] || "Unknown";
  }
  return fileName.replace(/\.vue$/, "");
}
