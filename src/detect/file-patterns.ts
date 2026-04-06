import fs from "node:fs/promises";
import path from "node:path";
import { type DetectionResult, type FrameworkId } from "../types/project.js";

interface PatternSignature {
  id: FrameworkId;
  patterns: { dir: string; files?: string[] }[];
  confidence: number;
  evidence: string;
}

const PATTERN_SIGNATURES: PatternSignature[] = [
  {
    id: "nextjs",
    patterns: [
      { dir: "app", files: ["page.tsx", "page.jsx", "page.js", "page.ts"] },
    ],
    confidence: 0.85,
    evidence: "Found Next.js App Router structure (app/page.tsx)",
  },
  {
    id: "nextjs",
    patterns: [
      { dir: "pages", files: ["_app.tsx", "_app.jsx", "_app.js"] },
    ],
    confidence: 0.8,
    evidence: "Found Next.js Pages Router structure (pages/_app.tsx)",
  },
  {
    id: "nuxt",
    patterns: [
      { dir: "pages", files: ["index.vue"] },
    ],
    confidence: 0.7,
    evidence: "Found Nuxt pages structure (pages/index.vue)",
  },
  {
    id: "sveltekit",
    patterns: [
      { dir: "src/routes", files: ["+page.svelte"] },
    ],
    confidence: 0.9,
    evidence: "Found SvelteKit routes structure (src/routes/+page.svelte)",
  },
  {
    id: "angular",
    patterns: [
      { dir: "src/app", files: ["app.component.ts", "app.module.ts"] },
    ],
    confidence: 0.85,
    evidence: "Found Angular app structure (src/app/app.component.ts)",
  },
];

export async function detectFromFilePatterns(
  projectRoot: string
): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];

  for (const sig of PATTERN_SIGNATURES) {
    let matched = false;

    for (const pattern of sig.patterns) {
      const dirPath = path.join(projectRoot, pattern.dir);

      try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) continue;

        if (pattern.files) {
          for (const file of pattern.files) {
            try {
              await fs.access(path.join(dirPath, file));
              matched = true;
              break;
            } catch {
              // File doesn't exist
            }
          }
        } else {
          matched = true;
        }
      } catch {
        // Dir doesn't exist
      }

      if (matched) break;
    }

    if (matched) {
      results.push({
        frameworkId: sig.id,
        confidence: sig.confidence,
        evidence: [sig.evidence],
      });
    }
  }

  return results;
}
