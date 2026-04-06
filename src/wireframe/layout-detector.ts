import { ComponentInfo } from "../types/component.js";
import { PageComponentRef } from "../types/page.js";

const ROLE_PATTERNS: Record<string, RegExp[]> = {
  header: [/header/i, /navbar/i, /topbar/i, /top-bar/i, /appbar/i, /nav$/i],
  sidebar: [/sidebar/i, /sidenav/i, /side-nav/i, /drawer/i, /aside/i, /menu(?!item)/i],
  footer: [/footer/i, /bottom-bar/i, /bottombar/i],
  main: [/main/i, /content/i, /body/i, /workspace/i],
  widget: [/card/i, /widget/i, /stat/i, /chart/i, /graph/i, /panel/i],
  modal: [/modal/i, /dialog/i, /popup/i, /overlay/i, /drawer/i],
  layout: [/layout/i, /shell/i, /wrapper/i, /container/i, /template/i],
};

/**
 * Infer the role of a component based on its name
 */
export function inferComponentRole(
  name: string
): PageComponentRef["role"] {
  for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(name)) {
        return role as PageComponentRef["role"];
      }
    }
  }
  return "other";
}

/**
 * Assign roles to a list of components used in a page
 */
export function assignComponentRoles(
  components: ComponentInfo[]
): PageComponentRef[] {
  return components.map((comp) => ({
    name: comp.name,
    filePath: comp.filePath,
    role: inferComponentRole(comp.name),
    props: {},
  }));
}

/**
 * Determine if a component list suggests a typical page layout
 */
export function detectLayoutPattern(
  components: PageComponentRef[]
): "dashboard" | "sidebar-content" | "simple" | "form" | "list" {
  const roles = new Set(components.map((c) => c.role));

  if (roles.has("sidebar") && roles.has("header") && roles.has("widget")) {
    return "dashboard";
  }
  if (roles.has("sidebar")) {
    return "sidebar-content";
  }

  const names = components.map((c) => c.name.toLowerCase());
  if (names.some((n) => n.includes("form") || n.includes("input"))) {
    return "form";
  }
  if (names.some((n) => n.includes("table") || n.includes("list") || n.includes("grid"))) {
    return "list";
  }

  return "simple";
}
