import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";
import { ComponentInfo, PropInfo, StateInfo, ImportInfo, ComponentType } from "../types/component.js";

let project: Project | null = null;

export function getProject(tsConfigPath?: string): Project {
  if (!project) {
    project = new Project({
      tsConfigFilePath: tsConfigPath,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        jsx: 4, // JsxEmit.ReactJSX
      },
    });
  }
  return project;
}

export function resetProject(): void {
  project = null;
}

export function parseSourceFile(filePath: string, content: string): SourceFile {
  const proj = getProject();
  const existing = proj.getSourceFile(filePath);
  if (existing) {
    existing.replaceWithText(content);
    return existing;
  }
  return proj.createSourceFile(filePath, content, { overwrite: true });
}

/**
 * Extract ALL components from a file (not just the first one).
 * Returns an array of ComponentInfo.
 */
export function extractAllComponentsFromFile(
  filePath: string,
  content: string
): ComponentInfo[] {
  const sourceFile = parseSourceFile(filePath, content);
  const components: ComponentInfo[] = [];
  const isClient = content.includes('"use client"') || content.includes("'use client'");
  const isServer = !isClient && (filePath.replace(/\\/g, "/").includes("/app/"));
  const imports = extractImports(sourceFile);
  const allChildren = extractChildComponents(sourceFile);

  // Collect ALL exported components
  const found = findAllComponents(sourceFile);

  for (const comp of found) {
    const name = comp.name || inferNameFromPath(filePath);
    const props = extractPropsFromNode(sourceFile, comp.node);
    const state = extractStateFromNode(comp.node);
    const type = inferComponentType(filePath, name);

    // Determine which children belong to this component
    const compText = comp.node.getText();
    const children = extractChildrenFromText(compText);

    components.push({
      name,
      filePath,
      type,
      props,
      state,
      events: [],
      slots: [],
      imports,
      children,
      exportType: comp.exportType,
      isClientComponent: isClient,
      isServerComponent: isServer,
      description: extractJsDoc(comp.node),
      loc: {
        start: comp.node.getStartLineNumber(),
        end: comp.node.getEndLineNumber(),
      },
    });
  }

  // If no exported components found, still return file-level info for page/layout files
  if (components.length === 0 && isPageOrLayout(filePath)) {
    components.push({
      name: inferNameFromPath(filePath),
      filePath,
      type: inferComponentType(filePath, inferNameFromPath(filePath)),
      props: [],
      state: extractStateFromText(content),
      events: [],
      slots: [],
      imports,
      children: allChildren,
      exportType: "default",
      isClientComponent: isClient,
      isServerComponent: isServer,
      description: "",
      loc: { start: 1, end: content.split("\n").length },
    });
  }

  return components;
}

// Legacy compat — returns first component
export function extractComponentFromFile(
  filePath: string,
  content: string
): ComponentInfo | null {
  const all = extractAllComponentsFromFile(filePath, content);
  return all[0] || null;
}

// ─── Find ALL components ───

interface ComponentNode {
  name: string;
  node: Node;
  exportType: "default" | "named" | "none";
}

function findAllComponents(sourceFile: SourceFile): ComponentNode[] {
  const results: ComponentNode[] = [];
  const seen = new Set<string>();

  // 1. Default export
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (defaultExport) {
    const declarations = defaultExport.getDeclarations();
    for (const decl of declarations) {
      const rawName = defaultExport.getName();
      const name = rawName === "default" ? inferNameFromPath(sourceFile.getFilePath()) : rawName;
      if (!seen.has(name)) {
        seen.add(name);
        results.push({ name, node: decl, exportType: "default" });
      }
    }
  }

  // 2. ALL named exports (not just first)
  const exportedDeclarations = sourceFile.getExportedDeclarations();
  for (const [name, decls] of exportedDeclarations) {
    if (name === "default" || seen.has(name)) continue;
    for (const decl of decls) {
      if (looksLikeComponent(decl, name)) {
        seen.add(name);
        results.push({ name, node: decl, exportType: "named" });
      }
    }
  }

  // 3. Non-exported components that are used in JSX within the file
  // (internal helper components)
  const allFunctions = sourceFile.getFunctions();
  for (const fn of allFunctions) {
    const name = fn.getName();
    if (name && /^[A-Z]/.test(name) && !seen.has(name) && looksLikeComponent(fn, name)) {
      seen.add(name);
      results.push({ name, node: fn, exportType: "none" });
    }
  }

  // Variable statements with arrow function components
  const variableStatements = sourceFile.getVariableStatements();
  for (const stmt of variableStatements) {
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (/^[A-Z]/.test(name) && !seen.has(name)) {
        const initializer = decl.getInitializer();
        if (initializer && looksLikeComponent(initializer, name)) {
          seen.add(name);
          results.push({ name, node: decl, exportType: stmt.isExported() ? "named" : "none" });
        }
      }
    }
  }

  return results;
}

function looksLikeComponent(node: Node, name: string): boolean {
  // Must start with uppercase (React convention)
  if (!/^[A-Z]/.test(name)) return false;

  // Skip type aliases and interfaces
  if (Node.isTypeAliasDeclaration(node) || Node.isInterfaceDeclaration(node)) return false;
  if (Node.isEnumDeclaration(node)) return false;

  const text = node.getText();

  // Function/arrow that contains JSX
  if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    return containsJSX(text);
  }

  // Variable with arrow function
  if (Node.isVariableDeclaration(node)) {
    const init = node.getInitializer();
    if (init) return containsJSX(init.getText());
  }

  // React.forwardRef, React.memo wrappings
  if (text.includes("forwardRef") || text.includes("memo(")) {
    return containsJSX(text);
  }

  return false;
}

function containsJSX(text: string): boolean {
  // Look for JSX patterns: <Tag, </Tag>, <>, <Tag />, className=
  return (
    /<[A-Za-z][^>]*>/.test(text) ||
    /<\/[A-Za-z]/.test(text) ||
    /<>/.test(text) ||
    /jsx\(/.test(text) ||
    /jsxs?\(/.test(text) ||
    /createElement\(/.test(text)
  );
}

// ─── Props extraction using ts-morph type system ───

function extractPropsFromNode(sourceFile: SourceFile, componentNode: Node): PropInfo[] {
  const props: PropInfo[] = [];

  // Find the function parameters
  let paramNode: Node | undefined;

  if (Node.isFunctionDeclaration(componentNode)) {
    paramNode = componentNode.getParameters()[0];
  } else if (Node.isArrowFunction(componentNode)) {
    paramNode = componentNode.getParameters()[0];
  } else if (Node.isVariableDeclaration(componentNode)) {
    const init = componentNode.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      paramNode = init.getParameters()[0];
    }
  }

  if (!paramNode) return props;

  // Try to get the type of the parameter using ts-morph type checker
  try {
    const paramType = paramNode.getType();
    const properties = paramType.getProperties();

    for (const prop of properties) {
      const name = prop.getName();
      // Skip React internal props
      if (name === "children" || name === "key" || name === "ref") continue;

      const declarations = prop.getDeclarations();
      let typeText = "unknown";
      let isOptional = false;
      let defaultValue: string | null = null;

      try {
        const propType = prop.getTypeAtLocation(paramNode);
        typeText = propType.getText();
        // Clean up verbose type text
        typeText = simplifyType(typeText);
      } catch {
        // Fall back
      }

      for (const decl of declarations) {
        if (Node.isPropertySignature(decl)) {
          isOptional = decl.hasQuestionToken();
        }
      }

      // Try to find default value from destructuring
      const paramText = paramNode.getText();
      const defaultRegex = new RegExp(`${name}\\s*=\\s*([^,}]+)`);
      const defaultMatch = paramText.match(defaultRegex);
      if (defaultMatch) {
        defaultValue = defaultMatch[1].trim();
        isOptional = true;
      }

      props.push({
        name,
        type: typeText,
        required: !isOptional,
        defaultValue,
        description: getJsDocForProperty(declarations),
      });
    }
  } catch {
    // If type resolution fails, fall back to regex extraction
    return extractPropsFromText(componentNode.getText());
  }

  return props;
}

function simplifyType(typeText: string): string {
  // Remove import(...) prefixes
  typeText = typeText.replace(/import\([^)]+\)\./g, "");
  // Shorten common React types
  typeText = typeText.replace(/React\.ReactNode/g, "ReactNode");
  typeText = typeText.replace(/React\.ReactElement<[^>]+>/g, "ReactElement");
  typeText = typeText.replace(/React\.CSSProperties/g, "CSSProperties");
  typeText = typeText.replace(/React\.MouseEvent<[^>]+>/g, "MouseEvent");
  // Truncate very long types
  if (typeText.length > 80) {
    typeText = typeText.slice(0, 77) + "...";
  }
  return typeText;
}

function getJsDocForProperty(declarations: Node[]): string {
  for (const decl of declarations) {
    const jsDocs = (decl as any).getJsDocs?.();
    if (jsDocs && jsDocs.length > 0) {
      return jsDocs[0].getDescription?.()?.trim() || "";
    }
  }
  return "";
}

function extractPropsFromText(text: string): PropInfo[] {
  const props: PropInfo[] = [];
  const paramMatch = text.match(/\(\s*\{([^}]*)\}\s*(?::\s*(\w+(?:<[^>]+>)?))?\s*\)/);
  if (!paramMatch) return props;

  const entries = paramMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const defaultMatch = entry.match(/^(\w+)\s*=\s*(.+)$/);
    if (defaultMatch) {
      props.push({ name: defaultMatch[1], type: "unknown", required: false, defaultValue: defaultMatch[2].trim(), description: "" });
    } else {
      const name = entry.replace(/\s*:.+$/, "").replace(/\?$/, "");
      if (/^\w+$/.test(name)) {
        props.push({ name, type: "unknown", required: !entry.includes("?"), defaultValue: null, description: "" });
      }
    }
  }
  return props;
}

// ─── State extraction — all patterns ───

function extractStateFromNode(node: Node): StateInfo[] {
  return extractStateFromText(node.getText());
}

function extractStateFromText(text: string): StateInfo[] {
  const states: StateInfo[] = [];
  let match;

  // useState
  const useStateRegex = /const\s+\[(\w+),\s*(\w+)\]\s*=\s*(?:React\.)?useState(?:<([^>]+)>)?\(([^)]*)\)/g;
  while ((match = useStateRegex.exec(text)) !== null) {
    states.push({ name: match[1], type: match[3] || "unknown", initialValue: match[4] || null, setter: match[2], source: "useState" });
  }

  // useReducer
  const useReducerRegex = /const\s+\[(\w+),\s*(\w+)\]\s*=\s*(?:React\.)?useReducer/g;
  while ((match = useReducerRegex.exec(text)) !== null) {
    states.push({ name: match[1], type: "unknown", initialValue: null, setter: match[2], source: "useReducer" });
  }

  // useRef
  const useRefRegex = /const\s+(\w+)\s*=\s*(?:React\.)?useRef(?:<([^>]+)>)?\(([^)]*)\)/g;
  while ((match = useRefRegex.exec(text)) !== null) {
    states.push({ name: match[1], type: match[2] || "unknown", initialValue: match[3] || null, setter: null, source: "other" });
  }

  // Zustand: const useSomeStore = create(...)
  const zustandRegex = /const\s+(use\w+)\s*=\s*create(?:<[^>]+>)?\(/g;
  while ((match = zustandRegex.exec(text)) !== null) {
    states.push({ name: match[1], type: "store", initialValue: null, setter: null, source: "store" });
  }

  // Jotai: const someAtom = atom(...)
  const jotaiRegex = /(?:export\s+)?const\s+(\w+Atom)\s*=\s*atom(?:<[^>]+>)?\(/g;
  while ((match = jotaiRegex.exec(text)) !== null) {
    states.push({ name: match[1], type: "atom", initialValue: null, setter: null, source: "store" });
  }

  return states;
}

// ─── Child component detection ───

function extractChildComponents(sourceFile: SourceFile): string[] {
  return extractChildrenFromText(sourceFile.getFullText());
}

function extractChildrenFromText(text: string): string[] {
  const children = new Set<string>();

  // Match JSX component usage: <ComponentName or <Component.Name
  const jsxRegex = /<([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)?)\s/g;
  let match;
  while ((match = jsxRegex.exec(text)) !== null) {
    children.add(match[1]);
  }
  // Also match self-closing: <Component />
  const selfClosingRegex = /<([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)?)\s*\/>/g;
  while ((match = selfClosingRegex.exec(text)) !== null) {
    children.add(match[1]);
  }

  // Remove known React internals and HTML-like
  const ignore = new Set([
    "Fragment", "Suspense", "StrictMode", "Profiler", "Provider", "Consumer",
    "React", "Component", "PureComponent", "ErrorBoundary",
  ]);
  for (const el of ignore) {
    children.delete(el);
  }

  return Array.from(children);
}

// ─── Import extraction ───

function extractImports(sourceFile: SourceFile): ImportInfo[] {
  return sourceFile.getImportDeclarations().map((imp) => {
    const defaultImport = imp.getDefaultImport();
    const namedImports = imp.getNamedImports();
    const specifiers = [
      ...(defaultImport ? [defaultImport.getText()] : []),
      ...namedImports.map((n) => n.getName()),
    ];

    return {
      source: imp.getModuleSpecifierValue(),
      specifiers,
      isDefault: !!defaultImport,
      isType: imp.isTypeOnly(),
    };
  });
}

// ─── JSDoc extraction ───

function extractJsDoc(node: Node): string {
  try {
    const jsDocs = (node as any).getJsDocs?.();
    if (jsDocs && jsDocs.length > 0) {
      return jsDocs[0].getDescription?.()?.trim() || "";
    }
  } catch {
    // No JSDoc
  }
  return "";
}

// ─── Helpers ───

function inferNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1];

  if (fileName.match(/^index\.[jt]sx?$/)) {
    return parts[parts.length - 2] || "Unknown";
  }
  if (fileName.match(/^page\.[jt]sx?$/)) {
    const parent = parts[parts.length - 2];
    return parent === "app" ? "HomePage" : (parent || "Page");
  }
  if (fileName.match(/^layout\.[jt]sx?$/)) {
    const parent = parts[parts.length - 2];
    return (parent ? parent + "Layout" : "RootLayout");
  }

  return fileName.replace(/\.[jt]sx?$/, "");
}

function inferComponentType(filePath: string, name: string): ComponentType {
  const p = filePath.replace(/\\/g, "/").toLowerCase();

  if (p.match(/layout\.[jt]sx?$/) || p.includes("/layouts/")) return "layout";
  if (p.match(/page\.[jt]sx?$/) || p.includes("/pages/") || p.includes("/views/") || p.includes("/screens/")) return "page";

  if (p.includes("/hooks/") || p.includes("/composables/") || name.startsWith("use")) return "hook";
  if (p.includes("/providers/") || name.endsWith("Provider")) return "provider";
  if (p.includes("/hoc/") || name.startsWith("with")) return "hoc";
  if (p.includes("/stores/") || p.includes("/store/")) return "utility";
  if (p.includes("/utils/") || p.includes("/helpers/") || p.includes("/lib/")) {
    if (!containsJSX(name)) return "utility";
  }

  return "component";
}

function isPageOrLayout(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  return /\/(page|layout)\.[jt]sx?$/.test(p) || /\/pages\//.test(p);
}
