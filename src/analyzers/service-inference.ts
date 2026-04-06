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
  const routePaths = routes.filter((r) => !r.isApiRoute).map((r) => r.path.toLowerCase());
  const deps = Object.keys({
    ...(getDeps(project) || {}),
  });

  const domain: string[] = [];
  const features: string[] = [];

  // ─── Domain scoring: weighted signals from multiple sources ───

  interface DomainSignal {
    label: string;
    /** Strong signals: component/route names specific to this domain */
    strong: string[];
    /** Weak signals: generic words that might match anything */
    weak: string[];
    /** Dependency signals: npm packages that strongly indicate this domain */
    deps: string[];
  }

  const domainSignals: DomainSignal[] = [
    { label: "E-commerce", strong: ["cart", "checkout", "product", "catalog", "shop"], weak: ["order", "price", "payment"], deps: ["stripe", "shopify", "snipcart", "medusa"] },
    { label: "Dashboard / Analytics", strong: ["dashboard", "analytics", "metric", "kpi"], weak: ["chart", "stat", "report", "graph"], deps: ["recharts", "chart.js", "d3", "nivo", "victory"] },
    { label: "Authentication", strong: ["login", "signup", "register", "oauth"], weak: ["auth", "password", "session"], deps: ["next-auth", "@auth/core", "passport", "clerk", "@clerk/nextjs"] },
    { label: "Messaging / Chat", strong: ["chat", "conversation", "inbox", "messenger"], weak: ["message", "notification"], deps: ["socket.io", "pusher", "ably", "stream-chat"] },
    { label: "Content / Blog", strong: ["article", "blog", "post", "editor"], weak: ["comment", "feed", "timeline", "content"], deps: ["@tiptap/react", "slate", "draft-js", "mdx"] },
    { label: "Scheduling / Calendar", strong: ["calendar", "schedule", "booking", "appointment"], weak: ["event", "date"], deps: ["react-big-calendar", "fullcalendar", "@fullcalendar/core", "date-fns"] },
    { label: "Education / LMS", strong: ["lecture", "course", "lesson", "quiz", "exam", "student"], weak: ["teacher", "curriculum"], deps: [] },
    { label: "Healthcare", strong: ["patient", "doctor", "medical", "clinic", "diagnosis"], weak: ["health", "appointment"], deps: ["fhir"] },
    { label: "Billing / SaaS", strong: ["invoice", "billing", "subscription"], weak: ["plan", "pricing"], deps: ["stripe", "lemon-squeezy", "paddle"] },
    { label: "Maps / Location", strong: ["mapbox", "leaflet", "marker", "geolocation"], weak: ["map", "location", "place"], deps: ["mapbox-gl", "leaflet", "@react-google-maps/api", "maplibre-gl"] },
    { label: "Media / Streaming", strong: ["video-player", "streaming", "playlist", "media-player"], weak: ["video", "audio", "stream", "player"], deps: ["video.js", "plyr", "hls.js", "shaka-player"] },
    { label: "File Management", strong: ["file-manager", "file-browser", "document-viewer"], weak: ["upload", "file", "document", "storage"], deps: ["dropzone", "react-dropzone", "filepond"] },
    { label: "Project Management", strong: ["kanban", "sprint", "backlog", "roadmap"], weak: ["task", "board", "issue"], deps: ["react-beautiful-dnd", "@dnd-kit/core", "react-trello"] },
    { label: "Social Network", strong: ["social", "follow", "friend", "newsfeed"], weak: ["like", "share"], deps: [] },
    { label: "Admin Panel", strong: ["admin-panel", "crud", "data-grid"], weak: ["admin", "manage", "panel"], deps: ["react-admin", "@refinedev/core", "ag-grid"] },
    { label: "CMS", strong: ["cms", "page-builder", "content-management"], weak: ["content", "editor", "publish"], deps: ["@sanity/client", "contentful", "@strapi/strapi"] },
  ];

  // Score each domain
  const scores = new Map<string, number>();

  // 1. Project name + description (highest weight)
  const nameDesc = `${project.name} ${project.description}`.toLowerCase();
  for (const sig of domainSignals) {
    let score = 0;
    for (const s of sig.strong) {
      if (nameDesc.includes(s)) score += 5;
    }
    scores.set(sig.label, (scores.get(sig.label) || 0) + score);
  }

  // 2. Route paths (high weight — routes are deliberate naming)
  const routeStr = routePaths.join(" ");
  for (const sig of domainSignals) {
    let score = 0;
    for (const s of sig.strong) {
      if (routeStr.includes(s)) score += 3;
    }
    for (const s of sig.weak) {
      // Weak signals only count in routes if they appear as path segments
      if (routePaths.some((r) => r.split("/").includes(s))) score += 1;
    }
    scores.set(sig.label, (scores.get(sig.label) || 0) + score);
  }

  // 3. Dependencies (high weight — explicit library choice)
  for (const sig of domainSignals) {
    let score = 0;
    for (const d of sig.deps) {
      if (deps.some((dep) => dep.includes(d))) score += 4;
    }
    scores.set(sig.label, (scores.get(sig.label) || 0) + score);
  }

  // 4. Component names (medium weight)
  const nameStr = allNames.join(" ");
  for (const sig of domainSignals) {
    let score = 0;
    for (const s of sig.strong) {
      // Count actual components named with this signal (not substring)
      const count = allNames.filter((n) => n.includes(s)).length;
      score += count * 2;
    }
    // Weak signals need multiple matches from components to count
    let weakHits = 0;
    for (const s of sig.weak) {
      if (nameStr.includes(s)) weakHits++;
    }
    if (weakHits >= 2) score += weakHits;

    scores.set(sig.label, (scores.get(sig.label) || 0) + score);
  }

  // Pick domains with score >= 5
  const sortedDomains = Array.from(scores.entries())
    .filter(([, score]) => score >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [label] of sortedDomains) {
    domain.push(label);
  }

  // ─── Feature detection ───

  const allNamesStr = allNames.join(" ");
  const featureSignals: [string, () => boolean][] = [
    ["Real-time (WebSocket)", () => deps.some((d) => d.includes("socket") || d.includes("ws") || d.includes("pusher"))],
    ["Authentication", () => deps.some((d) => d.includes("auth") || d.includes("passport") || d.includes("jwt") || d.includes("clerk") || d.includes("supabase"))],
    ["File upload", () => allNamesStr.includes("upload") || deps.some((d) => d.includes("multer") || d.includes("dropzone"))],
    ["Internationalization", () => deps.some((d) => d.includes("i18n") || d.includes("intl") || d.includes("react-intl"))],
    ["Drag & drop", () => deps.some((d) => d.includes("dnd") || d.includes("drag") || d.includes("sortable"))],
    ["Charts/Visualization", () => deps.some((d) => d.includes("chart") || d.includes("d3") || d.includes("recharts") || d.includes("nivo"))],
    ["Form management", () => deps.some((d) => d.includes("formik") || d.includes("react-hook-form") || d.includes("yup") || d.includes("zod"))],
    ["Data tables", () => allNamesStr.includes("table") || deps.some((d) => d.includes("tanstack") || d.includes("ag-grid"))],
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
  else if (allNamesStr.includes("login") || allNamesStr.includes("auth")) auth = "Custom auth (detected from components)";

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
