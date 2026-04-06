import { ComponentInfo } from "../types/component.js";
import { RouteInfo } from "../types/page.js";
import { ProjectInfo } from "../types/project.js";

/**
 * Infer what the project/service does based on code analysis
 */
export interface ServiceProfile {
  /** One-line description: "교육 플랫폼", "E-commerce SPA", etc. */
  summary: string;
  /** Business domain keywords */
  domain: string[];
  /** Key features detected */
  features: string[];
  /** Architecture style */
  architecture: string;
  /** Data patterns */
  dataPatterns: string[];
  /** Auth method if detected */
  auth: string | null;
}

export function inferServiceProfile(
  project: ProjectInfo,
  components: ComponentInfo[],
  routes: RouteInfo[],
): ServiceProfile {
  const allNames = components.map((c) => c.name.toLowerCase());
  const allImports = new Set<string>();
  for (const c of components) {
    for (const imp of c.imports) {
      allImports.add(imp.source.toLowerCase());
    }
  }
  const routePaths = routes.map((r) => r.path.toLowerCase());
  const deps = Object.keys({
    ...(getDeps(project) || {}),
  });

  const domain: string[] = [];
  const features: string[] = [];

  // ─── Domain detection from component names, routes, deps ───

  const domainSignals: [string[], string][] = [
    [["cart", "checkout", "product", "order", "payment", "shop", "catalog", "price"], "E-commerce"],
    [["dashboard", "analytics", "chart", "stat", "metric", "report", "graph"], "Dashboard / Analytics"],
    [["auth", "login", "signup", "register", "password", "session", "oauth"], "Authentication"],
    [["chat", "message", "conversation", "inbox", "notification"], "Messaging / Chat"],
    [["post", "article", "blog", "comment", "feed", "timeline"], "Content / Blog"],
    [["calendar", "schedule", "event", "booking", "appointment"], "Scheduling / Calendar"],
    [["lecture", "course", "lesson", "student", "teacher", "quiz", "exam"], "Education / LMS"],
    [["patient", "doctor", "medical", "health", "appointment", "clinic"], "Healthcare"],
    [["invoice", "billing", "subscription", "plan", "pricing"], "Billing / SaaS"],
    [["map", "location", "place", "marker", "route", "geo"], "Maps / Location"],
    [["video", "player", "stream", "media", "audio"], "Media / Streaming"],
    [["file", "upload", "document", "folder", "storage"], "File Management"],
    [["user", "profile", "account", "setting", "preference"], "User Management"],
    [["admin", "panel", "manage", "crud", "table", "list"], "Admin Panel"],
    [["form", "input", "select", "field", "validation"], "Form-heavy"],
    [["kanban", "board", "task", "project", "sprint", "issue"], "Project Management"],
    [["social", "follow", "like", "share", "friend"], "Social Network"],
  ];

  const searchPool = [...allNames, ...routePaths, ...deps].join(" ");

  for (const [signals, label] of domainSignals) {
    const matchCount = signals.filter((s) => searchPool.includes(s)).length;
    if (matchCount >= 2) {
      domain.push(label);
    }
  }

  // ─── Feature detection ───

  const featureSignals: [string, () => boolean][] = [
    ["Real-time (WebSocket)", () => deps.some((d) => d.includes("socket") || d.includes("ws") || d.includes("pusher"))],
    ["Authentication", () => deps.some((d) => d.includes("auth") || d.includes("passport") || d.includes("jwt") || d.includes("clerk") || d.includes("supabase"))],
    ["File upload", () => searchPool.includes("upload") || deps.some((d) => d.includes("multer") || d.includes("dropzone"))],
    ["Internationalization", () => deps.some((d) => d.includes("i18n") || d.includes("intl") || d.includes("react-intl"))],
    ["Drag & drop", () => deps.some((d) => d.includes("dnd") || d.includes("drag") || d.includes("sortable"))],
    ["Charts/Visualization", () => deps.some((d) => d.includes("chart") || d.includes("d3") || d.includes("recharts") || d.includes("nivo"))],
    ["Form management", () => deps.some((d) => d.includes("formik") || d.includes("react-hook-form") || d.includes("yup") || d.includes("zod"))],
    ["Data tables", () => searchPool.includes("table") || deps.some((d) => d.includes("tanstack") || d.includes("ag-grid"))],
    ["Maps", () => deps.some((d) => d.includes("mapbox") || d.includes("leaflet") || d.includes("google-maps"))],
    ["Payments", () => deps.some((d) => d.includes("stripe") || d.includes("paypal") || d.includes("payment"))],
    ["Email", () => deps.some((d) => d.includes("nodemailer") || d.includes("sendgrid") || d.includes("mailgun"))],
    ["PDF generation", () => deps.some((d) => d.includes("pdf") || d.includes("jspdf") || d.includes("puppeteer"))],
    ["Animation", () => deps.some((d) => d.includes("framer-motion") || d.includes("gsap") || d.includes("lottie") || d.includes("spring"))],
    ["State machine", () => deps.some((d) => d.includes("xstate") || d.includes("robot"))],
    ["Server-side rendering", () => deps.some((d) => d === "next" || d === "nuxt" || d === "@sveltejs/kit")],
  ];

  for (const [label, check] of featureSignals) {
    if (check()) features.push(label);
  }

  // ─── Architecture style ───

  let architecture = "Single Page Application (SPA)";
  if (deps.some((d) => d === "next")) architecture = "Next.js (SSR/SSG hybrid)";
  else if (deps.some((d) => d === "nuxt" || d === "nuxt3")) architecture = "Nuxt (SSR/SSG hybrid)";
  else if (deps.some((d) => d === "@sveltejs/kit")) architecture = "SvelteKit (SSR)";
  else if (routes.length > 10) architecture = "Multi-page SPA with routing";
  else if (routes.length === 0 && components.length > 5) architecture = "Component library or single-page app";

  // ─── Data patterns ───

  const dataPatterns: string[] = [];
  if (deps.some((d) => d.includes("axios") || d.includes("fetch"))) dataPatterns.push("REST API calls");
  if (deps.some((d) => d.includes("graphql") || d.includes("apollo") || d.includes("urql"))) dataPatterns.push("GraphQL");
  if (deps.some((d) => d.includes("tanstack") || d.includes("react-query"))) dataPatterns.push("Server state (TanStack Query)");
  if (deps.some((d) => d === "swr")) dataPatterns.push("Server state (SWR)");
  if (deps.some((d) => d.includes("redux"))) dataPatterns.push("Global state (Redux)");
  if (deps.some((d) => d.includes("zustand"))) dataPatterns.push("Global state (Zustand)");
  if (deps.some((d) => d.includes("recoil"))) dataPatterns.push("Atomic state (Recoil)");
  if (deps.some((d) => d.includes("jotai"))) dataPatterns.push("Atomic state (Jotai)");
  if (deps.some((d) => d.includes("pinia"))) dataPatterns.push("Store (Pinia)");
  if (deps.some((d) => d.includes("vuex"))) dataPatterns.push("Store (Vuex)");

  const hasPropsOnly = components.filter((c) => c.state.length === 0 && c.props.length > 0).length;
  const hasState = components.filter((c) => c.state.length > 0).length;
  if (hasPropsOnly > hasState * 2) dataPatterns.push("Props-driven (minimal local state)");
  if (dataPatterns.length === 0) dataPatterns.push("Props drilling / local state");

  // ─── Auth detection ───

  let auth: string | null = null;
  if (deps.some((d) => d.includes("next-auth") || d.includes("@auth"))) auth = "NextAuth.js";
  else if (deps.some((d) => d.includes("clerk"))) auth = "Clerk";
  else if (deps.some((d) => d.includes("supabase"))) auth = "Supabase Auth";
  else if (deps.some((d) => d.includes("firebase"))) auth = "Firebase Auth";
  else if (deps.some((d) => d.includes("passport"))) auth = "Passport.js";
  else if (deps.some((d) => d.includes("jwt") || d.includes("jsonwebtoken"))) auth = "JWT-based";
  else if (searchPool.includes("login") || searchPool.includes("auth")) auth = "Custom auth (detected from components)";

  // ─── Summary ───

  const fw = project.framework.name;
  const domainStr = domain.length > 0 ? domain[0] : "Web application";
  const compCount = components.length;
  const summary = `${fw} ${domainStr} — ${compCount} components${routes.length > 0 ? `, ${routes.length} routes` : ""}`;

  return { summary, domain, features, architecture, dataPatterns, auth };
}

// ─── Code pattern analysis for rules ───

export interface CodePattern {
  name: string;
  description: string;
  evidence: string[];
  frequency: "always" | "common" | "sometimes";
}

export function detectCodePatterns(components: ComponentInfo[]): CodePattern[] {
  const patterns: CodePattern[] = [];
  const total = components.length;
  if (total === 0) return patterns;

  // Component style: class vs function
  const classComps = components.filter((c) => c.description?.includes("class") || false);
  const funcComps = total - classComps.length;
  if (funcComps === total) {
    patterns.push({ name: "Function components only", description: "All components are function components (no class components)", evidence: [], frequency: "always" });
  } else if (classComps.length > 0) {
    patterns.push({ name: "Mixed class/function components", description: `${classComps.length} class + ${funcComps} function components`, evidence: [], frequency: "common" });
  }

  // Export style
  const defaultExports = components.filter((c) => c.exportType === "default").length;
  const namedExports = components.filter((c) => c.exportType === "named").length;
  if (defaultExports > namedExports * 2) {
    patterns.push({ name: "Default exports preferred", description: "Components use export default", evidence: [], frequency: "common" });
  } else if (namedExports > defaultExports * 2) {
    patterns.push({ name: "Named exports preferred", description: "Components use named exports", evidence: [], frequency: "common" });
  }

  // Client vs Server components
  const clientComps = components.filter((c) => c.isClientComponent).length;
  const serverComps = components.filter((c) => c.isServerComponent).length;
  if (clientComps > 0 && serverComps > 0) {
    patterns.push({ name: "Client/Server component split", description: `${clientComps} client + ${serverComps} server components`, evidence: [], frequency: "common" });
  }

  // Common import sources
  const importFreq = new Map<string, number>();
  for (const c of components) {
    for (const imp of c.imports) {
      if (imp.source.startsWith(".") || imp.source.startsWith("@/") || imp.source.startsWith("~/")) continue;
      importFreq.set(imp.source, (importFreq.get(imp.source) || 0) + 1);
    }
  }
  const topImports = Array.from(importFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([, count]) => count >= Math.max(2, total * 0.1));

  if (topImports.length > 0) {
    patterns.push({
      name: "Key libraries used across components",
      description: topImports.map(([src, count]) => `${src} (${count}x)`).join(", "),
      evidence: topImports.map(([src]) => src),
      frequency: "common",
    });
  }

  // State management patterns
  const stateUsage = new Map<string, number>();
  for (const c of components) {
    for (const s of c.state) {
      stateUsage.set(s.source, (stateUsage.get(s.source) || 0) + 1);
    }
  }
  for (const [source, count] of stateUsage) {
    if (count >= 2) {
      patterns.push({
        name: `State: ${source}`,
        description: `${source} used in ${count} components`,
        evidence: [],
        frequency: count > total * 0.3 ? "common" : "sometimes",
      });
    }
  }

  // Multi-component files
  const fileCompCount = new Map<string, number>();
  for (const c of components) {
    fileCompCount.set(c.filePath, (fileCompCount.get(c.filePath) || 0) + 1);
  }
  const multiCompFiles = Array.from(fileCompCount.values()).filter((c) => c > 1).length;
  if (multiCompFiles > 0) {
    patterns.push({
      name: "Co-located components",
      description: `${multiCompFiles} files contain multiple components`,
      evidence: [],
      frequency: multiCompFiles > total * 0.1 ? "common" : "sometimes",
    });
  }

  return patterns;
}

function getDeps(project: ProjectInfo): Record<string, string> | null {
  // Reconstruct deps from techStack info
  const deps: Record<string, string> = {};
  for (const lib of project.techStack.otherLibraries) {
    deps[lib.name] = lib.version;
  }
  // Add known deps from framework
  deps[project.framework.name.toLowerCase()] = project.framework.version;
  for (const s of project.techStack.styling) deps[s.toLowerCase()] = "";
  for (const s of project.techStack.stateManagement) deps[s.toLowerCase()] = "";
  for (const s of project.techStack.testing) deps[s.toLowerCase()] = "";
  return deps;
}
