import { ComponentInfo } from "./component.js";

export interface RouteInfo {
  path: string;
  filePath: string;
  name: string;
  layout: string | null;
  isApiRoute: boolean;
  isDynamic: boolean;
  params: string[];
  children: RouteInfo[];
  metadata: RouteMetadata;
}

export interface RouteMetadata {
  title: string | null;
  description: string | null;
  isProtected: boolean;
  middleware: string[];
}

export interface PageInfo {
  route: RouteInfo;
  components: PageComponentRef[];
  wireframe: WireframeNode | null;
  description: string;
  dataFetching: DataFetchingInfo[];
}

export interface PageComponentRef {
  name: string;
  filePath: string;
  role: "layout" | "header" | "sidebar" | "main" | "footer" | "widget" | "modal" | "other";
  props: Record<string, string>;
}

export interface WireframeNode {
  type: "container" | "component" | "slot" | "text";
  name: string;
  direction: "horizontal" | "vertical";
  children: WireframeNode[];
  width: number | "auto" | "fill";
  height: number | "auto" | "fill";
  role: string;
}

export interface DataFetchingInfo {
  method: string;
  endpoint: string | null;
  type: "ssr" | "ssg" | "csr" | "isr" | "streaming";
}

export interface PageTree {
  pages: PageInfo[];
  routes: RouteInfo[];
  layouts: string[];
}
