import fs from "node:fs/promises";
import path from "node:path";
import { type DetectionResult, type FrameworkId } from "../types/project.js";

interface FrameworkSignature {
  id: FrameworkId;
  dependencies: string[];
  confidence: number;
}

const SIGNATURES: FrameworkSignature[] = [
  { id: "nextjs", dependencies: ["next"], confidence: 0.9 },
  { id: "nuxt", dependencies: ["nuxt", "nuxt3"], confidence: 0.9 },
  { id: "sveltekit", dependencies: ["@sveltejs/kit"], confidence: 0.9 },
  { id: "angular", dependencies: ["@angular/core"], confidence: 0.9 },
  { id: "vue", dependencies: ["vue"], confidence: 0.6 },
  { id: "react", dependencies: ["react"], confidence: 0.6 },
  { id: "svelte", dependencies: ["svelte"], confidence: 0.6 },
];

export async function detectFromPackageJson(
  projectRoot: string
): Promise<DetectionResult[]> {
  const pkgPath = path.join(projectRoot, "package.json");
  let pkgContent: string;

  try {
    pkgContent = await fs.readFile(pkgPath, "utf-8");
  } catch {
    return [];
  }

  const pkg = JSON.parse(pkgContent);
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  const results: DetectionResult[] = [];

  for (const sig of SIGNATURES) {
    for (const dep of sig.dependencies) {
      if (dep in allDeps) {
        results.push({
          frameworkId: sig.id,
          confidence: sig.confidence,
          evidence: [`Found "${dep}": "${allDeps[dep]}" in package.json`],
        });
        break;
      }
    }
  }

  return results;
}

export async function readPackageJson(
  projectRoot: string
): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(
      path.join(projectRoot, "package.json"),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return null;
  }
}
