import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import {
  createFeature, getFeature, listFeatures, updateFeature,
  addPageToFeature, addComponentToFeature, addApiToFeature,
} from "../../features/manager.js";

export const featureCommand = new Command("feature")
  .description("Manage feature specifications");

featureCommand
  .command("add <name>")
  .description("Create a new feature spec")
  .option("-d, --description <text>", "Feature description")
  .action(async (name: string, opts) => {
    const specDir = path.resolve(".specwriter");
    const feature = await createFeature(specDir, name, opts.description || name, null);
    console.log(`\n  Created feature: ${feature.name} [${feature.status}]`);
    console.log(`  File: .specwriter/features/${feature.slug}.md\n`);
  });

featureCommand
  .command("list")
  .description("List all features")
  .action(async () => {
    const specDir = path.resolve(".specwriter");
    const features = await listFeatures(specDir);
    if (features.length === 0) {
      console.log("\n  No features. Use: specwriter feature add \"Feature Name\"\n");
      return;
    }
    console.log("");
    for (const f of features) {
      const counts = [
        f.pages.length > 0 ? `${f.pages.length} pages` : null,
        f.components.length > 0 ? `${f.components.length} components` : null,
        f.api.length > 0 ? `${f.api.length} endpoints` : null,
      ].filter(Boolean).join(", ");
      console.log(`  [${f.status.padEnd(11)}] ${f.name} — ${f.description}${counts ? ` (${counts})` : ""}`);
    }
    console.log("");
  });

featureCommand
  .command("get <name>")
  .description("Show a feature spec")
  .action(async (name: string) => {
    const specDir = path.resolve(".specwriter");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const feature = await getFeature(specDir, slug);
    if (!feature) {
      console.log(`\n  Feature "${name}" not found.\n`);
      return;
    }
    // Read and print the markdown
    const fs = await import("node:fs/promises");
    try {
      const md = await fs.readFile(path.join(specDir, "features", `${slug}.md`), "utf-8");
      console.log("\n" + md);
    } catch {
      console.log(`\n  Feature "${name}" has no markdown file.\n`);
    }
  });

featureCommand
  .command("page <feature>")
  .description("Add a page to a feature")
  .requiredOption("-r, --route <path>", "Page route (e.g. /login)")
  .option("-d, --description <text>", "Page description", "")
  .option("-c, --components <names...>", "Components on this page")
  .action(async (feature: string, opts) => {
    const specDir = path.resolve(".specwriter");
    const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const result = await addPageToFeature(specDir, slug, {
      route: opts.route,
      description: opts.description,
      components: opts.components || [],
    });
    if (!result) { console.log(`\n  Feature "${feature}" not found.\n`); return; }
    console.log(`\n  Added page ${opts.route} to "${result.name}"\n`);
  });

featureCommand
  .command("component <feature>")
  .description("Add a component to a feature")
  .requiredOption("-n, --name <name>", "Component name")
  .option("-d, --description <text>", "Component description", "")
  .option("-p, --props <props...>", "Component props")
  .option("--new", "Mark as new component (default)", true)
  .option("--existing", "Mark as existing component")
  .action(async (feature: string, opts) => {
    const specDir = path.resolve(".specwriter");
    const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const result = await addComponentToFeature(specDir, slug, {
      name: opts.name,
      description: opts.description,
      props: opts.props || [],
      isNew: !opts.existing,
    });
    if (!result) { console.log(`\n  Feature "${feature}" not found.\n`); return; }
    console.log(`\n  Added component ${opts.name} to "${result.name}"\n`);
  });

featureCommand
  .command("api <feature>")
  .description("Add an API endpoint to a feature")
  .requiredOption("-m, --method <method>", "HTTP method (GET, POST, PUT, DELETE)")
  .requiredOption("-p, --path <path>", "API path (e.g. /api/auth/login)")
  .option("-d, --description <text>", "Endpoint description", "")
  .action(async (feature: string, opts) => {
    const specDir = path.resolve(".specwriter");
    const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const result = await addApiToFeature(specDir, slug, {
      method: opts.method.toUpperCase(),
      path: opts.path,
      description: opts.description,
    });
    if (!result) { console.log(`\n  Feature "${feature}" not found.\n`); return; }
    console.log(`\n  Added ${opts.method.toUpperCase()} ${opts.path} to "${result.name}"\n`);
  });

featureCommand
  .command("status <feature> <status>")
  .description("Update feature status (draft, in-progress, done)")
  .option("-n, --notes <text>", "Implementation notes")
  .action(async (feature: string, status: string, opts) => {
    const specDir = path.resolve(".specwriter");
    const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const updates: Record<string, unknown> = { status };
    if (opts.notes) updates.notes = opts.notes;
    const result = await updateFeature(specDir, slug, updates);
    if (!result) { console.log(`\n  Feature "${feature}" not found.\n`); return; }
    console.log(`\n  "${result.name}" → [${result.status}]\n`);
  });

featureCommand
  .command("figma <url>")
  .description("Import a Figma design as wireframe spec")
  .requiredOption("-t, --token <token>", "Figma personal access token (or set FIGMA_TOKEN env)")
  .option("-f, --feature <name>", "Feature to attach wireframe to")
  .option("-n, --name <name>", "Override page name")
  .option("-r, --route <route>", "Page route")
  .action(async (url: string, opts) => {
    const { figmaUrlToWireframe } = await import("../../features/figma.js");
    const { wireframeToMarkdown, extractComponentsFromWireframe } = await import("../../features/wireframe.js");

    const token = opts.token || process.env.FIGMA_TOKEN;
    if (!token) {
      console.log("\n  Error: Figma token required. Use --token or set FIGMA_TOKEN env.\n");
      return;
    }

    console.log("\n  Fetching from Figma...");

    try {
      const wireframe = await figmaUrlToWireframe(url, token, opts.name, opts.route);
      const md = wireframeToMarkdown(wireframe);
      const extracted = extractComponentsFromWireframe(wireframe);

      // Save wireframe
      const specDir = path.resolve(".specwriter");
      const wireframeDir = path.join(specDir, "wireframes");
      await fs.mkdir(wireframeDir, { recursive: true });
      const fileName = wireframe.pageName.toLowerCase().replace(/\s+/g, "-");
      await fs.writeFile(path.join(wireframeDir, `${fileName}.md`), md);

      // Attach to feature if specified
      if (opts.feature) {
        const slug = opts.feature.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        let feature = await getFeature(specDir, slug);
        if (!feature) {
          await createFeature(specDir, opts.feature, `Imported from Figma: ${wireframe.pageName}`, null);
          feature = await getFeature(specDir, slug);
        }
        if (feature) {
          await addPageToFeature(specDir, slug, {
            route: wireframe.route,
            description: `${wireframe.pageName} (from Figma)\n\n${md}`,
            components: extracted.map((c) => c.name),
          });
          for (const comp of extracted) {
            if (!feature.components.some((c) => c.name === comp.name)) {
              await addComponentToFeature(specDir, slug, {
                name: comp.name,
                description: `${comp.role} component (from Figma)`,
                props: [],
                isNew: true,
              });
            }
          }
        }
      }

      console.log(`\n  Imported: ${wireframe.pageName}`);
      console.log(`  Sections: ${wireframe.sections.length}`);
      console.log(`  Components: ${extracted.map((c) => c.name).join(", ")}`);
      console.log(`  Saved: .specwriter/wireframes/${fileName}.md`);
      if (opts.feature) console.log(`  Attached to feature: ${opts.feature}`);
      console.log("");
      console.log(md);
    } catch (err) {
      console.log(`\n  Error: ${(err as Error).message}\n`);
    }
  });
