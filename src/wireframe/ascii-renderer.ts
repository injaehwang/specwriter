import { WireframeNode } from "../types/page.js";

const BOX_CHARS = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
};

export interface RenderOptions {
  width: number;
  indent: number;
}

const DEFAULT_OPTIONS: RenderOptions = {
  width: 60,
  indent: 0,
};

/**
 * Render a wireframe tree as ASCII box diagram
 */
export function renderWireframe(
  node: WireframeNode,
  options: Partial<RenderOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines = renderNode(node, opts.width, 0);
  return lines.join("\n");
}

function renderNode(
  node: WireframeNode,
  width: number,
  depth: number
): string[] {
  if (depth > 5) return [`  ${"  ".repeat(depth)}[${node.name}]`];

  if (node.children.length === 0) {
    return renderLeaf(node, width);
  }

  if (node.direction === "horizontal") {
    return renderHorizontalLayout(node, width, depth);
  }

  return renderVerticalLayout(node, width, depth);
}

function renderLeaf(node: WireframeNode, width: number): string[] {
  const inner = width - 4;
  const label = `<${node.name}>`;
  const padded = label.length > inner ? label.slice(0, inner) : label;

  return [
    `${BOX_CHARS.topLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.topRight}`,
    `${BOX_CHARS.vertical} ${padded}${" ".repeat(Math.max(0, width - 3 - padded.length))}${BOX_CHARS.vertical}`,
    `${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.bottomRight}`,
  ];
}

function renderVerticalLayout(
  node: WireframeNode,
  width: number,
  depth: number
): string[] {
  const lines: string[] = [];
  const innerWidth = width - 4;

  // Top border
  lines.push(
    `${BOX_CHARS.topLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.topRight}`
  );

  // Title if not container at root
  if (node.name && node.name !== "root") {
    const label = `<${node.name}>`;
    lines.push(
      `${BOX_CHARS.vertical} ${label}${" ".repeat(Math.max(0, width - 3 - label.length))}${BOX_CHARS.vertical}`
    );
    lines.push(
      `${BOX_CHARS.teeRight}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.teeLeft}`
    );
  }

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childLines = renderNode(child, innerWidth, depth + 1);

    for (const childLine of childLines) {
      lines.push(
        `${BOX_CHARS.vertical} ${childLine}${" ".repeat(Math.max(0, width - 3 - childLine.length))}${BOX_CHARS.vertical}`
      );
    }

    // Separator between children
    if (i < node.children.length - 1) {
      lines.push(
        `${BOX_CHARS.teeRight}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.teeLeft}`
      );
    }
  }

  // Bottom border
  lines.push(
    `${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.bottomRight}`
  );

  return lines;
}

function renderHorizontalLayout(
  node: WireframeNode,
  width: number,
  depth: number
): string[] {
  const childCount = node.children.length;
  if (childCount === 0) return renderLeaf(node, width);

  // Calculate child widths
  const innerWidth = width - 2;
  const dividers = childCount - 1;
  const availableWidth = innerWidth - dividers;
  const childWidth = Math.max(10, Math.floor(availableWidth / childCount));

  // Render each child
  const childBlocks = node.children.map((child) =>
    renderNode(child, childWidth, depth + 1)
  );

  // Normalize heights
  const maxHeight = Math.max(...childBlocks.map((b) => b.length));
  for (const block of childBlocks) {
    while (block.length < maxHeight) {
      block.push(" ".repeat(childWidth));
    }
  }

  // Merge horizontally
  const lines: string[] = [];

  // Top border with title
  lines.push(
    `${BOX_CHARS.topLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.topRight}`
  );

  if (node.name && node.name !== "root") {
    const label = `<${node.name}>`;
    lines.push(
      `${BOX_CHARS.vertical} ${label}${" ".repeat(Math.max(0, width - 3 - label.length))}${BOX_CHARS.vertical}`
    );
    lines.push(
      `${BOX_CHARS.teeRight}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.teeLeft}`
    );
  }

  for (let row = 0; row < maxHeight; row++) {
    const rowParts = childBlocks.map((block) => {
      const line = block[row] || " ".repeat(childWidth);
      return line.length >= childWidth
        ? line.slice(0, childWidth)
        : line + " ".repeat(childWidth - line.length);
    });
    const rowStr = rowParts.join(BOX_CHARS.vertical);
    const padded = rowStr.length < innerWidth
      ? rowStr + " ".repeat(innerWidth - rowStr.length)
      : rowStr.slice(0, innerWidth);
    lines.push(`${BOX_CHARS.vertical}${padded}${BOX_CHARS.vertical}`);
  }

  lines.push(
    `${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.bottomRight}`
  );

  return lines;
}

/**
 * Generate a simple wireframe tree from component names and their roles
 */
export function buildWireframeFromComponents(
  components: { name: string; role: string; children?: string[] }[]
): WireframeNode {
  const root: WireframeNode = {
    type: "container",
    name: "root",
    direction: "vertical",
    children: [],
    width: "fill",
    height: "auto",
    role: "root",
  };

  const header = components.find((c) =>
    ["header", "navbar", "topbar", "nav"].includes(c.role.toLowerCase())
  );
  const sidebar = components.find((c) =>
    ["sidebar", "sidenav", "drawer"].includes(c.role.toLowerCase())
  );
  const footer = components.find((c) =>
    ["footer", "bottombar"].includes(c.role.toLowerCase())
  );
  const mainContent = components.filter(
    (c) => c !== header && c !== sidebar && c !== footer
  );

  // Build layout
  if (header) {
    root.children.push(makeLeaf(header.name, "header"));
  }

  if (sidebar && mainContent.length > 0) {
    const middle: WireframeNode = {
      type: "container",
      name: "",
      direction: "horizontal",
      children: [
        makeLeaf(sidebar.name, "sidebar"),
        {
          type: "container",
          name: "Main",
          direction: "vertical",
          children: mainContent.map((c) => makeLeaf(c.name, c.role)),
          width: "fill",
          height: "fill",
          role: "main",
        },
      ],
      width: "fill",
      height: "fill",
      role: "middle",
    };
    root.children.push(middle);
  } else {
    for (const c of mainContent) {
      root.children.push(makeLeaf(c.name, c.role));
    }
  }

  if (footer) {
    root.children.push(makeLeaf(footer.name, "footer"));
  }

  return root;
}

function makeLeaf(name: string, role: string): WireframeNode {
  return {
    type: "component",
    name,
    direction: "vertical",
    children: [],
    width: "auto",
    height: "auto",
    role,
  };
}
