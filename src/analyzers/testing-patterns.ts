import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

export interface TestingPatternAnalysis {
  /** Testing framework detected */
  framework: string | null;
  /** E2E framework detected */
  e2eFramework: string | null;
  /** Number of test files */
  testFileCount: number;
  /** Number of E2E test files */
  e2eFileCount: number;
  /** Test file naming pattern */
  namingPattern: string | null;
  /** Test directory */
  testDir: string | null;
  /** Patterns extracted from existing tests */
  patterns: string[];
  /** Selectors used: data-testid, data-cy, role, etc. */
  selectorStrategy: string | null;
}

export async function analyzeTestingPatterns(
  projectRoot: string,
  deps: Record<string, string>,
): Promise<TestingPatternAnalysis> {
  const result: TestingPatternAnalysis = {
    framework: null,
    e2eFramework: null,
    testFileCount: 0,
    e2eFileCount: 0,
    namingPattern: null,
    testDir: null,
    patterns: [],
    selectorStrategy: null,
  };

  // Detect unit test framework
  if ("vitest" in deps) result.framework = "Vitest";
  else if ("jest" in deps) result.framework = "Jest";
  else if ("mocha" in deps) result.framework = "Mocha";

  // Detect E2E framework
  if ("@playwright/test" in deps || "playwright" in deps) result.e2eFramework = "Playwright";
  else if ("cypress" in deps) result.e2eFramework = "Cypress";

  if (!result.framework && !result.e2eFramework) return result;

  // Count test files
  try {
    const testFiles = await glob("**/*.{test,spec}.{ts,tsx,js,jsx}", {
      cwd: projectRoot, posix: true,
      ignore: ["**/node_modules/**", "**/dist/**"],
    });
    result.testFileCount = testFiles.length;

    // Detect naming pattern
    const specCount = testFiles.filter((f) => f.includes(".spec.")).length;
    const testCount = testFiles.filter((f) => f.includes(".test.")).length;
    if (specCount > testCount) result.namingPattern = "*.spec.ts";
    else if (testCount > 0) result.namingPattern = "*.test.ts";
  } catch {}

  // Find E2E test directory and files
  const e2eDirs = ["e2e", "tests/e2e", "test/e2e", "tests", "cypress/e2e", "playwright"];
  for (const dir of e2eDirs) {
    try {
      const stat = await fs.stat(path.join(projectRoot, dir));
      if (stat.isDirectory()) {
        result.testDir = dir;
        break;
      }
    } catch {}
  }

  // Count E2E files
  if (result.e2eFramework === "Playwright") {
    try {
      const e2eFiles = await glob("**/*.{test,spec}.{ts,js}", {
        cwd: path.join(projectRoot, result.testDir || "e2e"),
        posix: true,
      });
      result.e2eFileCount = e2eFiles.length;

      // Analyze patterns from existing E2E files
      if (e2eFiles.length > 0) {
        await analyzeE2EPatterns(projectRoot, result.testDir || "e2e", e2eFiles, result);
      }
    } catch {}
  } else if (result.e2eFramework === "Cypress") {
    try {
      const e2eFiles = await glob("**/*.cy.{ts,js,tsx,jsx}", {
        cwd: projectRoot, posix: true,
        ignore: ["**/node_modules/**"],
      });
      result.e2eFileCount = e2eFiles.length;
    } catch {}
  }

  return result;
}

async function analyzeE2EPatterns(
  projectRoot: string,
  testDir: string,
  files: string[],
  result: TestingPatternAnalysis,
) {
  // Read up to 5 test files to extract patterns
  const sampled = files.slice(0, 5);
  let usesPageObject = false;
  let usesFixtures = false;
  let usesDataTestId = false;
  let usesDataCy = false;
  let usesRole = false;
  let usesGetByText = false;

  for (const file of sampled) {
    try {
      const content = await fs.readFile(path.join(projectRoot, testDir, file), "utf-8");

      // Page Object pattern
      if (content.includes("class") && content.includes("Page") && content.includes("this.page")) {
        usesPageObject = true;
      }

      // Fixtures
      if (content.includes("test.extend") || content.includes("fixtures")) {
        usesFixtures = true;
      }

      // Selector strategies
      if (content.includes("data-testid") || content.includes("getByTestId")) usesDataTestId = true;
      if (content.includes("data-cy")) usesDataCy = true;
      if (content.includes("getByRole")) usesRole = true;
      if (content.includes("getByText")) usesGetByText = true;

      // Common patterns
      if (content.includes("beforeEach")) result.patterns.push("Uses beforeEach for setup");
      if (content.includes("test.describe")) result.patterns.push("Groups tests with describe blocks");
      if (content.includes("expect(page)")) result.patterns.push("Asserts on page state");
      if (content.includes("toHaveURL")) result.patterns.push("Asserts URL navigation");
      if (content.includes("screenshot")) result.patterns.push("Takes screenshots");
    } catch {}
  }

  // Deduplicate patterns
  result.patterns = [...new Set(result.patterns)];

  // Determine selector strategy
  if (usesDataTestId) result.selectorStrategy = "data-testid";
  else if (usesDataCy) result.selectorStrategy = "data-cy";
  else if (usesRole) result.selectorStrategy = "getByRole (accessibility)";
  else if (usesGetByText) result.selectorStrategy = "getByText";

  if (usesPageObject) result.patterns.unshift("Page Object pattern");
  if (usesFixtures) result.patterns.unshift("Custom fixtures");
}

export function testingPatternsToMarkdown(analysis: TestingPatternAnalysis, lang: string): string {
  if (!analysis.framework && !analysis.e2eFramework) return "";

  const L: string[] = [];
  const isKo = lang === "ko";

  L.push(`## ${isKo ? "테스트" : "Testing"}`);
  L.push("");

  if (analysis.framework) {
    L.push(`**${isKo ? "단위 테스트" : "Unit"}:** ${analysis.framework} (${analysis.testFileCount} ${isKo ? "개 파일" : "files"})`);
  }
  if (analysis.e2eFramework) {
    L.push(`**E2E:** ${analysis.e2eFramework} (${analysis.e2eFileCount} ${isKo ? "개 파일" : "files"})`);
  }
  if (analysis.testDir) {
    L.push(`**${isKo ? "테스트 디렉토리" : "Test dir"}:** \`${analysis.testDir}/\``);
  }
  if (analysis.namingPattern) {
    L.push(`**${isKo ? "파일 패턴" : "Pattern"}:** \`${analysis.namingPattern}\``);
  }
  if (analysis.selectorStrategy) {
    L.push(`**${isKo ? "셀렉터" : "Selectors"}:** ${analysis.selectorStrategy}`);
  }

  if (analysis.patterns.length > 0) {
    L.push("");
    L.push(isKo ? "**기존 테스트 패턴:**" : "**Existing test patterns:**");
    for (const p of analysis.patterns) {
      L.push(`- ${p}`);
    }
  }

  L.push("");
  return L.join("\n");
}
