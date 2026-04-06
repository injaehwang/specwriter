import { ComponentInfo } from "../types/component.js";

export interface UiPattern {
  name: string;
  description: string;
  components: string[];
  hooks: string[];
  usage: string;
}

/**
 * Detect common UI patterns from component names, imports, and relationships
 */
export function detectUiPatterns(components: ComponentInfo[]): UiPattern[] {
  const patterns: UiPattern[] = [];
  const names = components.map((c) => c.name.toLowerCase());
  const allImports = new Set<string>();
  for (const c of components) {
    for (const imp of c.imports) {
      allImports.add(imp.source);
      for (const spec of imp.specifiers) {
        allImports.add(spec.toLowerCase());
      }
    }
  }

  // ─── Modal / Dialog ───
  const modalComps = components.filter((c) =>
    /modal|dialog|popup|overlay|drawer/i.test(c.name)
  );
  const modalHooks = components.filter((c) =>
    c.type === "hook" && /modal|dialog|drawer/i.test(c.name)
  );
  if (modalComps.length > 0) {
    const hookNames = modalHooks.map((h) => h.name);
    patterns.push({
      name: "Modal / Dialog",
      description: `${modalComps.length} modal component(s)`,
      components: modalComps.map((c) => c.name),
      hooks: hookNames,
      usage: hookNames.length > 0
        ? `const { open, close } = ${hookNames[0]}(); <${modalComps[0].name} isOpen={isOpen} onClose={close} />`
        : `<${modalComps[0].name} isOpen={isOpen} onClose={onClose} />`,
    });
  }

  // ─── Form ───
  const formComps = components.filter((c) =>
    /form|input|select|textarea|checkbox|radio|field/i.test(c.name)
  );
  const hasRHF = allImports.has("react-hook-form") || allImports.has("useform");
  const hasFormik = allImports.has("formik") || allImports.has("useformik");
  const hasZod = allImports.has("zod");
  const hasYup = allImports.has("yup");
  if (formComps.length > 0 || hasRHF || hasFormik) {
    const lib = hasRHF ? "react-hook-form" : hasFormik ? "formik" : "native forms";
    const validator = hasZod ? " + zod" : hasYup ? " + yup" : "";
    patterns.push({
      name: "Forms",
      description: `${formComps.length} form component(s), ${lib}${validator}`,
      components: formComps.slice(0, 5).map((c) => c.name),
      hooks: hasRHF ? ["useForm"] : hasFormik ? ["useFormik"] : [],
      usage: hasRHF
        ? `const { register, handleSubmit } = useForm<Schema>({ resolver: zodResolver(schema) })`
        : `<form onSubmit={handleSubmit}>...</form>`,
    });
  }

  // ─── Data Table / List ───
  const tableComps = components.filter((c) =>
    /table|datagrid|list(?!en)/i.test(c.name)
  );
  if (tableComps.length > 0) {
    patterns.push({
      name: "Data Tables",
      description: `${tableComps.length} table/list component(s)`,
      components: tableComps.map((c) => c.name),
      hooks: [],
      usage: `<${tableComps[0].name} data={data} columns={columns} />`,
    });
  }

  // ─── Navigation ───
  const navComps = components.filter((c) =>
    /nav|menu|sidebar|header|footer|breadcrumb|tab/i.test(c.name)
  );
  if (navComps.length > 0) {
    patterns.push({
      name: "Navigation",
      description: `${navComps.length} navigation component(s)`,
      components: navComps.map((c) => c.name),
      hooks: [],
      usage: navComps.map((c) => `<${c.name} />`).join(", "),
    });
  }

  // ─── Loading / Skeleton ───
  const loadingComps = components.filter((c) =>
    /loading|skeleton|spinner|loader/i.test(c.name)
  );
  if (loadingComps.length > 0) {
    patterns.push({
      name: "Loading States",
      description: `${loadingComps.length} loading component(s)`,
      components: loadingComps.map((c) => c.name),
      hooks: [],
      usage: `<${loadingComps[0].name} />`,
    });
  }

  // ─── Toast / Notification ───
  const toastComps = components.filter((c) =>
    /toast|notification|snackbar|alert/i.test(c.name)
  );
  const toastHooks = components.filter((c) =>
    c.type === "hook" && /toast|notification/i.test(c.name)
  );
  if (toastComps.length > 0 || allImports.has("react-hot-toast") || allImports.has("sonner")) {
    const lib = allImports.has("sonner") ? "sonner" : allImports.has("react-hot-toast") ? "react-hot-toast" : "custom";
    patterns.push({
      name: "Notifications",
      description: `${lib}${toastComps.length > 0 ? ` + ${toastComps.length} component(s)` : ""}`,
      components: toastComps.map((c) => c.name),
      hooks: toastHooks.map((h) => h.name),
      usage: lib === "sonner" ? `toast.success("Done!")` : `toast("Message")`,
    });
  }

  // ─── Cards / Widgets ───
  const cardComps = components.filter((c) =>
    /card|widget|panel|tile/i.test(c.name)
  );
  if (cardComps.length > 0) {
    patterns.push({
      name: "Cards / Widgets",
      description: `${cardComps.length} card component(s)`,
      components: cardComps.map((c) => c.name),
      hooks: [],
      usage: `<${cardComps[0].name} title="..." />`,
    });
  }

  // ─── Button variants ───
  const btnComps = components.filter((c) =>
    /^button/i.test(c.name) || /btn/i.test(c.name)
  );
  if (btnComps.length > 0) {
    const mainBtn = btnComps[0];
    const variantProp = mainBtn.props.find((p) =>
      /variant|type|kind|style/i.test(p.name) && p.type.includes("|")
    );
    patterns.push({
      name: "Buttons",
      description: variantProp
        ? `${btnComps.length} button(s) with variants: ${variantProp.type}`
        : `${btnComps.length} button component(s)`,
      components: btnComps.map((c) => c.name),
      hooks: [],
      usage: variantProp
        ? `<${mainBtn.name} variant="primary" onClick={handler}>Text</${mainBtn.name}>`
        : `<${mainBtn.name} onClick={handler}>Text</${mainBtn.name}>`,
    });
  }

  return patterns;
}

export function uiPatternsToMarkdown(patterns: UiPattern[]): string {
  if (patterns.length === 0) return "";

  const L: string[] = [];
  L.push("## UI Patterns");
  L.push("");

  for (const p of patterns) {
    L.push(`### ${p.name}`);
    L.push(`${p.description}`);
    L.push("");
    L.push("```tsx");
    L.push(p.usage);
    L.push("```");
    L.push("");
    if (p.components.length > 0) {
      L.push(`Components: ${p.components.map((c) => `\`${c}\``).join(", ")}`);
    }
    if (p.hooks.length > 0) {
      L.push(`Hooks: ${p.hooks.map((h) => `\`${h}\``).join(", ")}`);
    }
    L.push("");
  }

  return L.join("\n");
}
