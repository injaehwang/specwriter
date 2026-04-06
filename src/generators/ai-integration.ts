import fs from "node:fs/promises";
import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";

export async function generateAiIntegration(
  spec: SpecOutput,
  config: AnalysisConfig
): Promise<void> {
  if (config.aiTargets.includes("claude")) {
    await generateClaudeMd(spec, config);
  }
  if (config.aiTargets.includes("cursor")) {
    await generateCursorRules(spec, config);
  }
}

async function generateClaudeMd(
  spec: SpecOutput,
  config: AnalysisConfig
): Promise<void> {
  const outputDir = path.resolve(config.root, config.output);
  const content = buildAiContext(spec, "claude");
  await fs.writeFile(path.join(outputDir, "CLAUDE.md"), content);
}

async function generateCursorRules(
  spec: SpecOutput,
  config: AnalysisConfig
): Promise<void> {
  const outputDir = path.resolve(config.root, config.output);
  const content = buildAiContext(spec, "cursor");
  await fs.writeFile(path.join(outputDir, ".cursorrules"), content);
}

function buildAiContext(
  spec: SpecOutput,
  target: "claude" | "cursor"
): string {
  const { project, rules, pageTree, components } = spec;
  const lines: string[] = [];

  if (target === "claude") {
    lines.push(`# Project: ${project.name}`);
  } else {
    lines.push(`# ${project.name} - Project Rules`);
  }
  lines.push("");

  // Tech Stack
  lines.push("## Tech Stack");
  lines.push(`- **Framework:** ${project.framework.name} ${project.framework.version}`);
  lines.push(`- **Language:** ${project.techStack.language}`);
  lines.push(`- **Build Tool:** ${project.techStack.buildTool}`);
  if (project.techStack.styling.length > 0) {
    lines.push(`- **Styling:** ${project.techStack.styling.join(", ")}`);
  }
  if (project.techStack.stateManagement.length > 0) {
    lines.push(`- **State Management:** ${project.techStack.stateManagement.join(", ")}`);
  }
  if (project.techStack.testing.length > 0) {
    lines.push(`- **Testing:** ${project.techStack.testing.join(", ")}`);
  }
  lines.push("");

  // Architecture
  lines.push("## Architecture");
  lines.push(`- **Routing:** ${project.framework.routingStrategy}`);
  if (project.structure.pagesDir) {
    lines.push(`- **Pages/Routes:** \`${project.structure.pagesDir}/\``);
  }
  if (project.structure.componentsDir) {
    lines.push(`- **Components:** \`${project.structure.componentsDir}/\``);
  }
  if (project.structure.apiDir) {
    lines.push(`- **API Routes:** \`${project.structure.apiDir}/\``);
  }
  lines.push("");

  // Coding Conventions
  lines.push("## Coding Conventions");
  lines.push(`- **Components:** ${rules.naming.components}`);
  lines.push(`- **Files:** ${rules.naming.files}`);
  lines.push(`- **Functions:** ${rules.naming.functions}`);
  lines.push(`- **Variables:** ${rules.naming.variables}`);
  lines.push("");

  // Route map
  const pageRoutes = pageTree.routes.filter((r) => !r.isApiRoute);
  if (pageRoutes.length > 0) {
    lines.push("## Route Map");
    lines.push("");
    for (const route of pageRoutes) {
      const dynamic = route.isDynamic ? ` [${route.params.join(", ")}]` : "";
      lines.push(`- \`${route.path}\`${dynamic} → \`${route.filePath}\``);
    }
    lines.push("");
  }

  // Key Components
  const keyComponents = components
    .filter((c) => c.type !== "utility" && c.type !== "hook")
    .slice(0, 30);

  if (keyComponents.length > 0) {
    lines.push("## Key Components");
    lines.push("");
    for (const comp of keyComponents) {
      const propsStr = comp.props.length > 0
        ? ` (props: ${comp.props.map((p) => p.name).join(", ")})`
        : "";
      lines.push(`- **${comp.name}** [\`${comp.filePath}\`] — ${comp.type}${propsStr}`);
    }
    lines.push("");
  }

  // Reference to full specs
  lines.push("## Full Specifications");
  lines.push("");
  lines.push(`Detailed specifications are available in the \`.specwriter/\` directory:`);
  lines.push(`- **Project Overview:** \`.specwriter/spec.md\``);
  lines.push(`- **Coding Rules:** \`.specwriter/rules.md\``);
  lines.push(`- **Route Map:** \`.specwriter/pages/_index.md\``);
  lines.push(`- **Component Registry:** \`.specwriter/components/_index.md\``);
  lines.push(`- **Individual Pages:** \`.specwriter/pages/<name>.md\``);
  lines.push(`- **Individual Components:** \`.specwriter/components/<name>.md\``);
  lines.push("");

  return lines.join("\n");
}
