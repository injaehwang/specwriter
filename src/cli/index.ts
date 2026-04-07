import { Command } from "commander";
import { createRequire } from "node:module";
import { analyzeCommand } from "./commands/analyze.js";
import { initCommand } from "./commands/init.js";
import { infoCommand } from "./commands/info.js";
import { serveCommand } from "./commands/serve.js";
import { featureCommand } from "./commands/feature.js";

const require = createRequire(import.meta.url);
const pkg = require("../../../package.json");

export const cli = new Command()
  .name("specwriter")
  .description("Analyze projects and generate specifications for AI coding assistants")
  .version(pkg.version);

cli.addCommand(analyzeCommand);
cli.addCommand(initCommand);
cli.addCommand(infoCommand);
cli.addCommand(serveCommand);
cli.addCommand(featureCommand);
