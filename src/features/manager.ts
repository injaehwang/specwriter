import fs from "node:fs/promises";
import path from "node:path";
import { ComponentInfo } from "../types/component.js";
import { SpecOutput } from "../types/spec.js";

export interface FeatureSpec {
  name: string;
  slug: string;
  description: string;
  status: "draft" | "in-progress" | "done";
  createdAt: string;
  updatedAt: string;
  /** Pages this feature needs */
  pages: FeaturePage[];
  /** Components this feature needs */
  components: FeatureComponent[];
  /** API endpoints this feature needs */
  api: FeatureApi[];
  /** Existing components/patterns to reuse */
  reuse: string[];
  /** Implementation notes */
  notes: string;
}

export interface FeaturePage {
  route: string;
  description: string;
  components: string[];
}

export interface FeatureComponent {
  name: string;
  description: string;
  props: string[];
  isNew: boolean;
}

export interface FeatureApi {
  method: string;
  path: string;
  description: string;
}

// ─── Feature CRUD ───

export async function createFeature(
  specDir: string,
  name: string,
  description: string,
  spec: SpecOutput | null,
): Promise<FeatureSpec> {
  const slug = toSlug(name);
  const featuresDir = path.join(specDir, "features");
  await fs.mkdir(featuresDir, { recursive: true });

  // Auto-suggest reusable components from existing spec
  const reuse: string[] = [];
  if (spec) {
    const suggestions = suggestReusable(name, description, spec);
    reuse.push(...suggestions);
  }

  const feature: FeatureSpec = {
    name,
    slug,
    description,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pages: [],
    components: [],
    api: [],
    reuse,
    notes: "",
  };

  await writeFeature(specDir, feature);
  return feature;
}

export async function getFeature(specDir: string, slug: string): Promise<FeatureSpec | null> {
  const filePath = path.join(specDir, "features", `${slug}.json`);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as FeatureSpec;
  } catch {
    return null;
  }
}

export async function listFeatures(specDir: string): Promise<FeatureSpec[]> {
  const featuresDir = path.join(specDir, "features");
  try {
    const entries = await fs.readdir(featuresDir);
    const features: FeatureSpec[] = [];
    for (const entry of entries) {
      if (entry.endsWith(".json")) {
        try {
          const content = await fs.readFile(path.join(featuresDir, entry), "utf-8");
          features.push(JSON.parse(content));
        } catch {
          // Skip invalid
        }
      }
    }
    return features.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function updateFeature(
  specDir: string,
  slug: string,
  updates: Partial<FeatureSpec>,
): Promise<FeatureSpec | null> {
  const feature = await getFeature(specDir, slug);
  if (!feature) return null;

  Object.assign(feature, updates, { updatedAt: new Date().toISOString() });
  await writeFeature(specDir, feature);
  return feature;
}

export async function addPageToFeature(
  specDir: string,
  slug: string,
  page: FeaturePage,
): Promise<FeatureSpec | null> {
  const feature = await getFeature(specDir, slug);
  if (!feature) return null;

  feature.pages.push(page);
  feature.updatedAt = new Date().toISOString();
  await writeFeature(specDir, feature);
  return feature;
}

export async function addComponentToFeature(
  specDir: string,
  slug: string,
  component: FeatureComponent,
): Promise<FeatureSpec | null> {
  const feature = await getFeature(specDir, slug);
  if (!feature) return null;

  feature.components.push(component);
  feature.updatedAt = new Date().toISOString();
  await writeFeature(specDir, feature);
  return feature;
}

export async function addApiToFeature(
  specDir: string,
  slug: string,
  api: FeatureApi,
): Promise<FeatureSpec | null> {
  const feature = await getFeature(specDir, slug);
  if (!feature) return null;

  feature.api.push(api);
  feature.updatedAt = new Date().toISOString();
  await writeFeature(specDir, feature);
  return feature;
}

// ─── Write feature as both JSON (for MCP) and MD (for AI reading) ───

async function writeFeature(specDir: string, feature: FeatureSpec): Promise<void> {
  const featuresDir = path.join(specDir, "features");
  await fs.mkdir(featuresDir, { recursive: true });

  // JSON for structured access
  await fs.writeFile(
    path.join(featuresDir, `${feature.slug}.json`),
    JSON.stringify(feature, null, 2) + "\n"
  );

  // MD for AI context
  await fs.writeFile(
    path.join(featuresDir, `${feature.slug}.md`),
    featureToMarkdown(feature)
  );
}

// ─── Suggest reusable components ───

function suggestReusable(name: string, description: string, spec: SpecOutput): string[] {
  const suggestions: string[] = [];
  const searchText = `${name} ${description}`.toLowerCase();

  // From UI patterns: shared components
  for (const comp of spec.components) {
    const compLower = comp.name.toLowerCase();

    // Suggest modals if feature mentions "dialog", "popup", "confirm"
    if (/modal|dialog|popup|confirm/i.test(searchText) && /modal|dialog/i.test(compLower)) {
      suggestions.push(`Reuse ${comp.name} (${comp.filePath}) for dialogs`);
    }
    // Suggest forms if feature mentions "form", "input"
    if (/form|input|submit/i.test(searchText) && /form|input/i.test(compLower)) {
      suggestions.push(`Reuse ${comp.name} (${comp.filePath}) for form UI`);
    }
    // Suggest layout components
    if (comp.type === "layout") {
      suggestions.push(`Use layout: ${comp.name} (${comp.filePath})`);
    }
  }

  // From page template
  if (spec.pageTree.pages.length > 0) {
    suggestions.push(`Follow existing page pattern from ${spec.pageTree.pages[0].route.filePath}`);
  }

  return suggestions.slice(0, 8);
}

// ─── Feature → Markdown ───

function featureToMarkdown(feature: FeatureSpec): string {
  const L: string[] = [];

  L.push(`# Feature: ${feature.name}`);
  L.push("");
  L.push(`> ${feature.description}`);
  L.push("");
  L.push(`**Status:** ${feature.status}`);
  L.push(`**Created:** ${feature.createdAt.split("T")[0]}`);
  L.push("");

  if (feature.pages.length > 0) {
    L.push("## Pages");
    L.push("");
    for (const page of feature.pages) {
      L.push(`### \`${page.route}\``);
      L.push(page.description);
      if (page.components.length > 0) {
        L.push(`Components: ${page.components.join(", ")}`);
      }
      L.push("");
    }
  }

  if (feature.components.length > 0) {
    L.push("## Components");
    L.push("");
    for (const comp of feature.components) {
      const tag = comp.isNew ? "NEW" : "EXISTING";
      L.push(`### ${comp.name} [${tag}]`);
      L.push(comp.description);
      if (comp.props.length > 0) {
        L.push(`Props: ${comp.props.join(", ")}`);
      }
      L.push("");
    }
  }

  if (feature.api.length > 0) {
    L.push("## API Endpoints");
    L.push("");
    L.push("| Method | Path | Description |");
    L.push("|--------|------|-------------|");
    for (const api of feature.api) {
      L.push(`| ${api.method} | \`${api.path}\` | ${api.description} |`);
    }
    L.push("");
  }

  if (feature.reuse.length > 0) {
    L.push("## Reuse from existing codebase");
    L.push("");
    for (const r of feature.reuse) {
      L.push(`- ${r}`);
    }
    L.push("");
  }

  if (feature.notes) {
    L.push("## Notes");
    L.push("");
    L.push(feature.notes);
    L.push("");
  }

  return L.join("\n");
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\uac00-\ud7a3]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
