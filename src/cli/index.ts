import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze.js";
import { initCommand } from "./commands/init.js";
import { infoCommand } from "./commands/info.js";

export const cli = new Command()
  .name("specwriter")
  .description("Analyze projects and generate specifications for AI coding assistants")
  .version("0.1.0");

cli.addCommand(analyzeCommand);
cli.addCommand(initCommand);
cli.addCommand(infoCommand);
