import fs from "node:fs/promises";
import path from "node:path";
import { type DetectionResult, type FrameworkId } from "../types/project.js";

interface ConfigSignature {
  id: FrameworkId;
  files: string[];
  confidence: number;
}

const CONFIG_SIGNATURES: ConfigSignature[] = [
  {
    id: "nextjs",
    files: [
      "next.config.js",
      "next.config.ts",
      "next.config.mjs",
      "next.config.cjs",
    ],
    confidence: 0.95,
  },
  {
    id: "nuxt",
    files: ["nuxt.config.ts", "nuxt.config.js"],
    confidence: 0.95,
  },
  {
    id: "sveltekit",
    files: ["svelte.config.js", "svelte.config.ts"],
    confidence: 0.85,
  },
  {
    id: "angular",
    files: ["angular.json", ".angular-cli.json"],
    confidence: 0.95,
  },
  {
    id: "vue",
    files: ["vue.config.js", "vue.config.ts"],
    confidence: 0.8,
  },
];

export async function detectFromConfigFiles(
  projectRoot: string
): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];

  for (const sig of CONFIG_SIGNATURES) {
    for (const file of sig.files) {
      const filePath = path.join(projectRoot, file);
      try {
        await fs.access(filePath);
        results.push({
          frameworkId: sig.id,
          confidence: sig.confidence,
          evidence: [`Found config file: ${file}`],
        });
        break;
      } catch {
        // File doesn't exist
      }
    }
  }

  return results;
}
