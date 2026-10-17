import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";

// Read the package version so development and compiled output stay consistent.
const packageInfo = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("ant-agent")
  .description("Our coding agent CLI")
  .version(packageInfo.version);

program
  .command("run")
  .description("Accept a repository task (agent execution comes next)")
  .argument("<task>", "What you want the agent to do")
  .option("--repo <path>", "Repository path", ".")
  .action((task: string, options: { repo: string }) => {
    console.log(`Task: ${task}`);
    console.log(`Repository: ${resolve(options.repo)}`);
  });

program.parse();
