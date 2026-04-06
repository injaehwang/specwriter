import { type DetectionResult, type FrameworkId } from "../types/project.js";
import { detectFromPackageJson } from "./package-json.js";
import { detectFromConfigFiles } from "./config-files.js";
import { detectFromFilePatterns } from "./file-patterns.js";

export async function detectFramework(
  projectRoot: string
): Promise<DetectionResult> {
  // Run all three detection layers
  const [pkgResults, configResults, patternResults] = await Promise.all([
    detectFromPackageJson(projectRoot),
    detectFromConfigFiles(projectRoot),
    detectFromFilePatterns(projectRoot),
  ]);

  // Merge results by framework, combining confidence and evidence
  const merged = new Map<
    FrameworkId,
    { confidence: number; evidence: string[] }
  >();

  const allResults = [...pkgResults, ...configResults, ...patternResults];

  for (const result of allResults) {
    const existing = merged.get(result.frameworkId);
    if (existing) {
      // Take highest confidence, combine evidence
      existing.confidence = Math.max(existing.confidence, result.confidence);
      existing.evidence.push(...result.evidence);
    } else {
      merged.set(result.frameworkId, {
        confidence: result.confidence,
        evidence: [...result.evidence],
      });
    }
  }

  // Boost confidence when multiple layers agree
  for (const [, data] of merged) {
    if (data.evidence.length >= 2) {
      data.confidence = Math.min(1.0, data.confidence + 0.05);
    }
    if (data.evidence.length >= 3) {
      data.confidence = Math.min(1.0, data.confidence + 0.05);
    }
  }

  // Pick the framework with highest confidence
  let best: DetectionResult = {
    frameworkId: "generic",
    confidence: 0,
    evidence: ["No specific framework detected"],
  };

  for (const [id, data] of merged) {
    if (data.confidence > best.confidence) {
      best = {
        frameworkId: id,
        confidence: data.confidence,
        evidence: data.evidence,
      };
    }
  }

  return best;
}

export { detectFromPackageJson } from "./package-json.js";
export { detectFromConfigFiles } from "./config-files.js";
export { detectFromFilePatterns } from "./file-patterns.js";
