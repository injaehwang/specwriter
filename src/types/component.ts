export interface ComponentInfo {
  name: string;
  filePath: string;
  type: ComponentType;
  props: PropInfo[];
  state: StateInfo[];
  events: EventInfo[];
  slots: SlotInfo[];
  imports: ImportInfo[];
  children: string[];
  exportType: "default" | "named" | "none";
  isClientComponent: boolean;
  isServerComponent: boolean;
  description: string;
  loc: { start: number; end: number };
}

export type ComponentType =
  | "page"
  | "layout"
  | "component"
  | "hook"
  | "utility"
  | "provider"
  | "hoc";

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  description: string;
}

export interface StateInfo {
  name: string;
  type: string;
  initialValue: string | null;
  setter: string | null;
  source: "useState" | "useReducer" | "ref" | "reactive" | "signal" | "store" | "other";
}

export interface EventInfo {
  name: string;
  payload: string;
  description: string;
}

export interface SlotInfo {
  name: string;
  props: PropInfo[];
  description: string;
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isType: boolean;
}

export interface ComponentGraph {
  nodes: ComponentNode[];
  edges: ComponentEdge[];
}

export interface ComponentNode {
  id: string;
  name: string;
  filePath: string;
  type: ComponentType;
}

export interface ComponentEdge {
  from: string;
  to: string;
  relation: "uses" | "extends" | "wraps" | "provides";
}
