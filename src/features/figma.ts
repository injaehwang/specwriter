import { WireframeSpec, WireframeSection, buildWireframe } from "./wireframe.js";

const FIGMA_API = "https://api.figma.com/v1";

// ─── URL parsing ───

interface FigmaParsedUrl {
  fileKey: string;
  nodeId: string | null;
}

export function parseFigmaUrl(url: string): FigmaParsedUrl | null {
  // https://www.figma.com/design/FILEKEY/name?node-id=X-Y
  // https://www.figma.com/file/FILEKEY/name?node-id=X-Y
  const match = url.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]{22,128})/);
  if (!match) return null;

  const fileKey = match[1];

  // Extract node-id from query params (URL uses hyphens, API uses colons)
  const nodeIdMatch = url.match(/node-id=([^&]+)/);
  const nodeId = nodeIdMatch
    ? decodeURIComponent(nodeIdMatch[1]).replace(/-/g, ":")
    : null;

  return { fileKey, nodeId };
}

// ─── Figma API fetch ───

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  characters?: string;
  visible?: boolean;
  componentId?: string;
}

interface FigmaApiResponse {
  name: string;
  document: FigmaNode;
  components: Record<string, { key: string; name: string; description: string }>;
}

interface FigmaNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode; components: Record<string, unknown> }>;
}

export async function fetchFigmaFile(
  fileKey: string,
  nodeId: string | null,
  token: string
): Promise<FigmaNode[]> {
  const headers = { "X-Figma-Token": token };

  if (nodeId) {
    // Fetch specific node
    const res = await fetch(`${FIGMA_API}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, { headers });
    if (!res.ok) throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
    const data = await res.json() as FigmaNodesResponse;
    const nodes = Object.values(data.nodes).map((n) => n.document).filter(Boolean);
    return nodes;
  } else {
    // Fetch entire file — get first page's frames
    const res = await fetch(`${FIGMA_API}/files/${fileKey}?depth=3`, { headers });
    if (!res.ok) throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
    const data = await res.json() as FigmaApiResponse;
    // Return top-level frames from first page
    const firstPage = data.document.children?.[0];
    if (!firstPage) return [];
    return firstPage.children || [];
  }
}

// ─── Convert Figma nodes to wireframe ───

export function figmaToWireframe(
  nodes: FigmaNode[],
  pageName: string,
  route: string
): WireframeSpec {
  const sections: WireframeSection[] = [];

  for (const node of nodes) {
    if (node.visible === false) continue;
    if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET" || node.type === "INSTANCE" || node.type === "GROUP") {
      const section = nodeToSection(node);
      if (section) sections.push(section);
    }
  }

  // If we got a single top-level frame, use its children as sections
  if (sections.length === 1 && nodes.length === 1 && nodes[0].children) {
    sections.length = 0;
    for (const child of nodes[0].children) {
      if (child.visible === false) continue;
      const section = nodeToSection(child);
      if (section) sections.push(section);
    }
  }

  return buildWireframe(pageName, route, sections);
}

function nodeToSection(node: FigmaNode): WireframeSection | null {
  const name = node.name || "Section";
  const role = inferRole(node);
  const components = extractComponentNames(node);
  const description = buildDescription(node);

  // Skip tiny/invisible nodes
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    if (width < 20 || height < 10) return null;
  }

  return {
    name: cleanName(name),
    role,
    description,
    components,
    position: inferPosition(node),
  };
}

function inferRole(node: FigmaNode): WireframeSection["role"] {
  const n = node.name.toLowerCase();
  const y = node.absoluteBoundingBox?.y ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;

  // Name-based
  if (/header|navbar|top.?bar|navigation|app.?bar/i.test(n)) return "header";
  if (/footer|bottom.?bar/i.test(n)) return "footer";
  if (/sidebar|side.?nav|drawer|menu/i.test(n)) return "sidebar";
  if (/nav/i.test(n)) return "nav";
  if (/modal|dialog|popup|overlay|sheet/i.test(n)) return "modal";
  if (/form|login|register|signup|input|search/i.test(n)) return "form";
  if (/list|table|grid|feed|cards/i.test(n)) return "list";
  if (/card|tile|widget|stat/i.test(n)) return "card";

  // Position-based (approximate)
  if (y < 80 && height < 120) return "header";

  // Layout-based
  if (node.layoutMode === "HORIZONTAL" && node.children && node.children.length > 2) return "nav";

  return "section";
}

function extractComponentNames(node: FigmaNode): string[] {
  const names = new Set<string>();

  function walk(n: FigmaNode, depth: number) {
    if (depth > 4) return;

    // Component instances and component sets
    if (n.type === "INSTANCE" || n.type === "COMPONENT") {
      const name = toPascalCase(cleanName(n.name));
      if (name && name.length > 1 && /^[A-Z]/.test(name)) {
        names.add(name);
      }
    }

    // Named groups that look like components
    if ((n.type === "FRAME" || n.type === "GROUP") && depth > 0) {
      const name = cleanName(n.name);
      if (/^[A-Z]/.test(name) && !name.includes(" ")) {
        names.add(name);
      }
    }

    if (n.children) {
      for (const child of n.children) {
        if (child.visible !== false) {
          walk(child, depth + 1);
        }
      }
    }
  }

  walk(node, 0);

  // Remove the section itself if it got added
  const sectionName = toPascalCase(cleanName(node.name));
  names.delete(sectionName);

  return Array.from(names).slice(0, 8);
}

function buildDescription(node: FigmaNode): string {
  // Collect text content from children
  const texts: string[] = [];

  function walkText(n: FigmaNode, depth: number) {
    if (depth > 3) return;
    if (n.type === "TEXT" && n.characters) {
      const text = n.characters.trim();
      if (text.length > 0 && text.length < 60) {
        texts.push(text);
      }
    }
    if (n.children) {
      for (const child of n.children) walkText(child, depth + 1);
    }
  }

  walkText(node, 0);

  if (texts.length === 0) return node.name;
  return texts.slice(0, 4).join(", ");
}

function inferPosition(node: FigmaNode): string {
  if (!node.absoluteBoundingBox) return "main";
  const { x, y } = node.absoluteBoundingBox;
  if (y < 80) return "top";
  if (x < 100) return "left";
  return "center";
}

function cleanName(name: string): string {
  // Remove Figma auto-numbering: "Frame 123", "Group 45"
  return name
    .replace(/^(Frame|Group|Rectangle|Ellipse|Line|Vector)\s*\d*$/i, "Section")
    .replace(/\s+/g, " ")
    .trim();
}

function toPascalCase(str: string): string {
  return str
    .split(/[\s_\-/]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

// ─── High-level: URL → WireframeSpec ───

export async function figmaUrlToWireframe(
  url: string,
  token: string,
  pageName?: string,
  route?: string
): Promise<WireframeSpec> {
  const parsed = parseFigmaUrl(url);
  if (!parsed) throw new Error("Invalid Figma URL");

  const nodes = await fetchFigmaFile(parsed.fileKey, parsed.nodeId, token);
  if (nodes.length === 0) throw new Error("No frames found in Figma file");

  const name = pageName || nodes[0]?.name || "Page";
  const r = route || "/" + name.toLowerCase().replace(/\s+/g, "-");

  return figmaToWireframe(nodes, name, r);
}
