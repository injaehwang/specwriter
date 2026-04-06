import { Project, SourceFile, SyntaxKind, Node, FunctionDeclaration, VariableDeclaration, ArrowFunction, FunctionExpression } from "ts-morph";
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

export function extractComponentFromFile(
  filePath: string,
  content: string
): ComponentInfo | null {
  const sourceFile = parseSourceFile(filePath, content);

  // Find the main exported component
  const component = findMainComponent(sourceFile);
  if (!component) return null;

  const name = component.name || inferNameFromPath(filePath);
  const isClient = content.includes('"use client"') || content.includes("'use client'");
  const isServer = !isClient && (filePath.includes("/app/") || filePath.includes("\\app\\"));

  const props = extractProps(sourceFile, component.node);
  const state = extractState(sourceFile);
  const imports = extractImports(sourceFile);
  const children = extractChildComponents(sourceFile);
  const type = inferComponentType(filePath, name);

  return {
    name,
    filePath,
    type,
    props,
    state,
    events: [],
    slots: [],
    imports,
    children,
    exportType: component.exportType,
    isClientComponent: isClient,
    isServerComponent: isServer,
    description: "",
    loc: {
      start: component.node.getStartLineNumber(),
      end: component.node.getEndLineNumber(),
    },
  };
}

interface ComponentNode {
  name: string;
  node: Node;
  exportType: "default" | "named" | "none";
}

function findMainComponent(sourceFile: SourceFile): ComponentNode | null {
  // Check default export first
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (defaultExport) {
    const declarations = defaultExport.getDeclarations();
    for (const decl of declarations) {
      const name = defaultExport.getName();
      return {
        name: name === "default" ? inferNameFromPath(sourceFile.getFilePath()) : name,
        node: decl,
        exportType: "default",
      };
    }
  }

  // Check named exports for function components
  const exportedDeclarations = sourceFile.getExportedDeclarations();
  for (const [name, decls] of exportedDeclarations) {
    if (name === "default") continue;
    for (const decl of decls) {
      if (isReactComponent(decl)) {
        return { name, node: decl, exportType: "named" };
      }
    }
  }

  return null;
}

function isReactComponent(node: Node): boolean {
  // Function declarations that return JSX
  if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const text = node.getText();
    return text.includes("return") && (text.includes("<") || text.includes("jsx"));
  }

  // Variable declarations with arrow functions
  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (initializer) return isReactComponent(initializer);
  }

  return false;
}

function extractProps(sourceFile: SourceFile, componentNode: Node): PropInfo[] {
  const props: PropInfo[] = [];
  const text = componentNode.getText();

  // Find destructured parameters: function Comp({ prop1, prop2 }: Props)
  const paramMatch = text.match(
    /\(\s*\{([^}]*)\}\s*(?::\s*(\w+(?:<[^>]+>)?))?\s*\)/
  );
  if (paramMatch) {
    const paramText = paramMatch[1];
    const entries = paramText.split(",").map((s) => s.trim()).filter(Boolean);

    for (const entry of entries) {
      // Handle: propName = defaultValue
      const defaultMatch = entry.match(/^(\w+)\s*=\s*(.+)$/);
      // Handle: propName: type (less common in destructuring)
      const typeMatch = entry.match(/^(\w+)\s*:\s*(\w+)$/);

      if (defaultMatch) {
        props.push({
          name: defaultMatch[1],
          type: "unknown",
          required: false,
          defaultValue: defaultMatch[2].trim(),
          description: "",
        });
      } else if (typeMatch) {
        // In destructuring, colon is rename, not type annotation
        props.push({
          name: typeMatch[1],
          type: "unknown",
          required: true,
          defaultValue: null,
          description: "",
        });
      } else {
        const name = entry.replace(/\?$/, "");
        props.push({
          name,
          type: "unknown",
          required: !entry.endsWith("?"),
          defaultValue: null,
          description: "",
        });
      }
    }
  }

  // Try to find and resolve Props interface/type
  const propsTypeMatch = text.match(
    /:\s*([\w]+(?:Props|Properties|Config))/
  );
  if (propsTypeMatch) {
    const typeName = propsTypeMatch[1];
    const typeDecl = sourceFile.getInterface(typeName) || sourceFile.getTypeAlias(typeName);
    if (typeDecl && Node.isInterfaceDeclaration(typeDecl)) {
      const members = typeDecl.getMembers();
      for (const member of members) {
        if (Node.isPropertySignature(member)) {
          const name = member.getName();
          const existing = props.find((p) => p.name === name);
          const typeText = member.getType().getText() || "unknown";
          const isOptional = member.hasQuestionToken();

          if (existing) {
            existing.type = typeText;
            existing.required = !isOptional;
          } else {
            props.push({
              name,
              type: typeText,
              required: !isOptional,
              defaultValue: null,
              description: "",
            });
          }
        }
      }
    }
  }

  return props;
}

function extractState(sourceFile: SourceFile): StateInfo[] {
  const states: StateInfo[] = [];
  const text = sourceFile.getFullText();

  // Match useState calls: const [name, setName] = useState(initialValue)
  const useStateRegex = /const\s+\[(\w+),\s*(\w+)\]\s*=\s*useState(?:<([^>]+)>)?\(([^)]*)\)/g;
  let match;
  while ((match = useStateRegex.exec(text)) !== null) {
    states.push({
      name: match[1],
      type: match[3] || "unknown",
      initialValue: match[4] || null,
      setter: match[2],
      source: "useState",
    });
  }

  // Match useReducer calls
  const useReducerRegex = /const\s+\[(\w+),\s*(\w+)\]\s*=\s*useReducer/g;
  while ((match = useReducerRegex.exec(text)) !== null) {
    states.push({
      name: match[1],
      type: "unknown",
      initialValue: null,
      setter: match[2],
      source: "useReducer",
    });
  }

  return states;
}

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

function extractChildComponents(sourceFile: SourceFile): string[] {
  const children = new Set<string>();
  const text = sourceFile.getFullText();

  // Match JSX component usage: <ComponentName or <Component.Name
  const jsxRegex = /<([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)?)\b/g;
  let match;
  while ((match = jsxRegex.exec(text)) !== null) {
    children.add(match[1]);
  }

  // Remove HTML-like elements that might have been caught
  const htmlElements = new Set([
    "Fragment", "Suspense", "StrictMode",
  ]);
  for (const el of htmlElements) {
    children.delete(el);
  }

  return Array.from(children);
}

function inferNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1];

  // If index file, use parent directory name
  if (fileName.match(/^index\.[jt]sx?$/)) {
    return parts[parts.length - 2] || "Unknown";
  }

  // If page file (Next.js), use parent directory name
  if (fileName.match(/^page\.[jt]sx?$/)) {
    return parts[parts.length - 2] || "Page";
  }

  // Otherwise use filename without extension
  return fileName.replace(/\.[jt]sx?$/, "");
}

function inferComponentType(filePath: string, name: string): ComponentType {
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

  if (normalizedPath.includes("/pages/") || normalizedPath.includes("/app/")) {
    if (normalizedPath.match(/layout\.[jt]sx?$/)) return "layout";
    if (normalizedPath.match(/page\.[jt]sx?$/) || normalizedPath.includes("/pages/")) return "page";
  }

  if (normalizedPath.includes("/hooks/") || name.startsWith("use")) return "hook";
  if (normalizedPath.includes("/providers/") || name.endsWith("Provider")) return "provider";
  if (normalizedPath.includes("/hoc/") || name.startsWith("with")) return "hoc";
  if (normalizedPath.includes("/utils/") || normalizedPath.includes("/helpers/")) return "utility";

  return "component";
}
