import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { runAgent } from "./core/run.js";
import type { ModelClient } from "./model/client.js";
import { additionScenario } from "./model/scenarios.js";
import { ScriptedModel } from "./model/scripted.js";
import { selectModel } from "./model/select.js";
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
  .description(
    "Run the add_numbers exchange (scripted by default; --model calls a real API)",
  )
  .option("--jsonl", "Print raw events as JSON lines")
  .option(
    "--model <provider/id>",
    "Use a real model, e.g. anthropic/claude-haiku-5-5",
  )
  .action(async (options: { jsonl?: boolean; model?: string }) => {
    const model = ((): ModelClient => {
      try {
        return options.model
          ? selectModel(options.model, process.env)
          : new ScriptedModel(additionScenario());
      } catch (error) {
        return program.error(`error: ${(error as Error).message}`, {
          exitCode: 2,
        });
      }
    })();
    const result = await runAgent({
      task: "What is 2 + 3? Use the add_numbers tool, then answer in one short sentence.",
      model,
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
      const { state, reason, text, toolCalls, usage } = event.payload.result;
      const cost =
        usage.unpricedRequests > 0
          ? `cost unknown for ${usage.unpricedRequests} of ${usage.modelRequests} requests`
          : `$${usage.costUsd.toFixed(6)}`;
      const outcome = reason ? `${state} (${reason})` : state;
      return `${prefix}  ${outcome}: "${text}" (${toolCalls} tool call, ${usage.modelRequests} model requests, ${usage.inputTokens} in + ${usage.cacheReadTokens} cached / ${usage.outputTokens} out tokens, ${cost})`;
    }
    default:
      return `${prefix}  ${JSON.stringify(event.payload)}`;
  }
}

await program.parseAsync();
