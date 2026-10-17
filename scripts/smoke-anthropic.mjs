// Paid smoke test against the real Anthropic API through the same consumer as
// the scripted demo. Not part of `pnpm check`; run it with `pnpm smoke:anthropic`.
// A local ledger enforces the total smoke-test budget across runs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runAgent } from "../dist/core/run.js";
import { PiModelClient } from "../dist/model/pi.js";
import {
  API_KEY_VARIABLES,
  MODEL_DEFAULTS,
  selectModel,
} from "../dist/model/select.js";
import { addNumbers } from "../dist/tools/add-numbers.js";

const MODEL = "anthropic/claude-haiku-5-5";
const BUDGET_USD = 1.0;
// Claude Haiku 5.5 list price per token for prompts under 100K tokens.
const PRICE = { input: 0.1 / 1e6, output: 0.5 / 1e6 };
const MAX_INPUT_TOKENS = 3000;
// Round-trip (2 requests) + abort (1). The invalid-key request is unbilled.
const PLANNED_REQUESTS = 3;
const WORST_REQUEST_USD =
  MAX_INPUT_TOKENS * PRICE.input +
  MODEL_DEFAULTS.maxOutputTokens * PRICE.output;
const WORST_RUN_USD =
  PLANNED_REQUESTS * (1 + MODEL_DEFAULTS.maxRetries) * WORST_REQUEST_USD;

const ledgerUrl = new URL("../.ant-agent/smoke-spend.json", import.meta.url);
const ledger = readLedger();

const keyVariable = API_KEY_VARIABLES.anthropic;
if (!process.env[keyVariable]?.trim()) {
  console.error(`Set ${keyVariable} to run the paid smoke test.`);
  process.exit(2);
}
if (ledger.spentUsd + WORST_RUN_USD > BUDGET_USD) {
  console.error(
    `Refusing: $${ledger.spentUsd.toFixed(4)} spent; worst case $${WORST_RUN_USD.toFixed(4)} would exceed the $${BUDGET_USD} budget.`,
  );
  process.exit(1);
}
console.log(
  `Budget $${BUDGET_USD}: spent $${ledger.spentUsd.toFixed(6)} so far; this run is capped at $${WORST_RUN_USD.toFixed(4)} worst case.\n`,
);

const failures = [];
const check = (scenario, condition, message) => {
  if (!condition) failures.push(`${scenario}: ${message}`);
};

// 1. Real tool round-trip.
{
  const events = [];
  const result = await runAgent({
    task: "What is 2 + 3? Use the add_numbers tool, then answer in one short sentence.",
    model: selectModel(MODEL, process.env),
    tools: [addNumbers],
    events: { emit: (e) => events.push(e) },
  });
  record("round-trip", result);
  check(
    "round-trip",
    result.state === "answered",
    `state ${result.state} ${result.reason ?? ""}`,
  );
  check("round-trip", result.toolCalls >= 1, "no tool call");
  check("round-trip", /\b5\b/.test(result.text), `answer "${result.text}"`);
  check("round-trip", result.usage.unreportedRequests === 0, "usage missing");
  check("round-trip", result.usage.unpricedRequests === 0, "cost missing");
  const results = events.filter((e) => e.type === "tool_result");
  check(
    "round-trip",
    results.every((e) => !e.payload.result.isError),
    "a tool call was rejected",
  );
  const stops = events
    .filter((e) => e.type === "model_response_completed")
    .map((e) => e.payload.stopReason);
  console.log(
    `round-trip: stop reasons ${stops.join(" -> ")}; "${result.text}"`,
  );
}

// 2. Abort after the first streamed text.
{
  const controller = new AbortController();
  let ran = 0;
  const result = await runAgent({
    task: "Write the numbers from 1 to 300, one per line, with no tools.",
    model: selectModel(MODEL, process.env),
    tools: [
      {
        ...addNumbers,
        run: async (...args) => {
          ran++;
          return addNumbers.run(...args);
        },
      },
    ],
    signal: controller.signal,
    events: { emit: (e) => e.type === "text_delta" && controller.abort() },
  });
  record("abort", result);
  check("abort", result.state === "cancelled", `state ${result.state}`);
  check("abort", ran === 0, "tool ran after abort");
  console.log(
    `abort: ${result.state} after ${result.usage.outputTokens} reported output tokens`,
  );
}

// 3. Invalid credentials: exactly one request, no retry, no usage.
{
  let requests = 0;
  const result = await runAgent({
    task: "Say hi.",
    model: new PiModelClient({
      provider: "anthropic",
      modelId: "claude-haiku-5-5",
      apiKey: "sk-ant-invalid-smoke-test-key",
      ...MODEL_DEFAULTS,
      fetch: (url, init) => {
        requests++;
        return fetch(url, init);
      },
    }),
    tools: [],
    events: { emit() {} },
  });
  record("invalid-key", result);
  check("invalid-key", result.state === "failed", `state ${result.state}`);
  check("invalid-key", requests === 1, `${requests} HTTP requests`);
  check("invalid-key", result.usage.unreportedRequests === 1, "usage reported");
  console.log(
    `invalid-key: ${result.state} after ${requests} request (${result.reason})`,
  );
}

console.log(
  `\nThis run: $${ledger.runs.at(-1).costUsd.toFixed(6)}. Total spent: $${ledger.spentUsd.toFixed(6)} of $${BUDGET_USD}.`,
);
if (failures.length > 0) {
  console.error(`\nFAILED\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Smoke test passed.");

function readLedger() {
  try {
    return JSON.parse(readFileSync(ledgerUrl, "utf8"));
  } catch {
    return { budgetUsd: BUDGET_USD, spentUsd: 0, runs: [] };
  }
}

// Unpriced requests are charged at the worst case so the budget stays safe.
function record(scenario, result) {
  const { usage } = result;
  const costUsd = usage.costUsd + usage.unpricedRequests * WORST_REQUEST_USD;
  if (!ledger.current) {
    ledger.current = {
      at: new Date().toISOString(),
      model: MODEL,
      costUsd: 0,
      scenarios: [],
    };
    ledger.runs.push(ledger.current);
  }
  // Invalid credentials are rejected before billing.
  const charged = scenario === "invalid-key" ? 0 : costUsd;
  ledger.current.costUsd += charged;
  ledger.current.scenarios.push({ scenario, state: result.state, usage });
  ledger.spentUsd += charged;
  const { current, ...persisted } = ledger;
  mkdirSync(new URL(".", ledgerUrl), { recursive: true });
  writeFileSync(ledgerUrl, `${JSON.stringify(persisted, null, 2)}\n`);
}
