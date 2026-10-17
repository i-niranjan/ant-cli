import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { runAgent } from "./core/run.js";
import { additionScenario } from "./model/scenarios.js";
import { ScriptedModel } from "./model/scripted.js";
import type { Event } from "./protocol/contracts.js";
import { addNumbers } from "./tools/add-numbers.js";

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

program
  .command("demo")
  .description("Replay a scripted model/tool exchange (no API call)")
  .option("--jsonl", "Print raw events as JSON lines")
  .action(async (options: { jsonl?: boolean }) => {
    const result = await runAgent({
      task: "What is 2 + 3?",
      model: new ScriptedModel(additionScenario()),
      tools: [addNumbers],
      events: {
        emit: (event) =>
          console.log(
            options.jsonl ? JSON.stringify(event) : describeEvent(event),
          ),
      },
    });
    process.exitCode = result.state === "answered" ? 0 : 1;
  });

function describeEvent(event: Event): string {
  const prefix = `${String(event.sequence).padStart(2)} ${event.type}`;
  switch (event.type) {
    case "run_finished": {
      const { state, text, toolCalls, usage } = event.payload.result;
      return `${prefix}  ${state}: "${text}" (${toolCalls} tool call, ${usage.modelRequests} model requests, ${usage.inputTokens}/${usage.outputTokens} tokens in/out)`;
    }
    default:
      return `${prefix}  ${JSON.stringify(event.payload)}`;
  }
}

await program.parseAsync();
