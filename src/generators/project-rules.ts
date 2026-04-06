import path from "node:path";
import { SpecOutput, AnalysisConfig } from "../types/spec.js";
import { writeJson, writeMarkdown } from "./index.js";

export async function generateProjectRules(
  spec: SpecOutput,
  outputDir: string,
  config: AnalysisConfig
): Promise<void> {
  const { rules } = spec;

  // JSON
  if (config.format === "json" || config.format === "both") {
    await writeJson(path.join(outputDir, "rules.json"), rules);
  }

  // Markdown
  if (config.format === "md" || config.format === "both") {
    const md = buildRulesMarkdown(spec);
    await writeMarkdown(path.join(outputDir, "rules.md"), md);
  }
}

function buildRulesMarkdown(spec: SpecOutput): string {
  const { rules, project } = spec;
  const lines: string[] = [];

  lines.push("# Coding Rules & Conventions");
  lines.push("");
  lines.push(`Project: ${project.name} (${project.framework.name})`);
  lines.push("");

  // Naming Conventions
  lines.push("## Naming Conventions");
  lines.push("");
  lines.push("| Element | Convention |");
  lines.push("|---------|-----------|");
  lines.push(`| Components | ${rules.naming.components} |`);
  lines.push(`| Files | ${rules.naming.files} |`);
  lines.push(`| Functions | ${rules.naming.functions} |`);
  lines.push(`| Variables | ${rules.naming.variables} |`);
  lines.push(`| CSS Classes | ${rules.naming.cssClasses} |`);
  lines.push(`| Directories | ${rules.naming.directories} |`);
  lines.push("");

  // Architecture Patterns
  if (rules.patterns.length > 0) {
    lines.push("## Architecture Patterns");
    lines.push("");
    for (const pattern of rules.patterns) {
      lines.push(`### ${pattern.name}`);
      lines.push("");
      lines.push(pattern.description);
      lines.push("");
      if (pattern.locations.length > 0) {
        lines.push("**Locations:**");
        for (const loc of pattern.locations) {
          lines.push(`- \`${loc}\``);
        }
        lines.push("");
      }
      if (pattern.examples.length > 0) {
        lines.push("**Examples:**");
        for (const ex of pattern.examples) {
          lines.push(`- ${ex}`);
        }
        lines.push("");
      }
    }
  }

  // File Organization
  if (rules.fileOrganization.length > 0) {
    lines.push("## File Organization");
    lines.push("");
    lines.push("| Pattern | Purpose |");
    lines.push("|---------|---------|");
    for (const rule of rules.fileOrganization) {
      lines.push(`| \`${rule.pattern}\` | ${rule.purpose} |`);
    }
    lines.push("");
  }

  // Import Conventions
  if (rules.importConventions.length > 0) {
    lines.push("## Import Conventions");
    lines.push("");
    for (const conv of rules.importConventions) {
      lines.push(`- **${conv.pattern}**: ${conv.description}`);
      lines.push(`  \`${conv.example}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}
