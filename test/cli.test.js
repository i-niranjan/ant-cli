import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);

function run(args, source = false) {
  return spawnSync(
    process.execPath,
    source
      ? ["--import", "tsx", "src/cli.ts", ...args]
      : ["dist/cli.js", ...args],
    { cwd: root, encoding: "utf8", timeout: 10_000 },
  );
}

test("help documents the entry point and exits successfully", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: ant-agent/);
  assert.match(result.stdout, /run/);
});

test("source and compiled CLI use the package version", () => {
  for (const source of [false, true]) {
    const result = run(["--version"], source);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), version);
  }
});

test("preserves a multiword task and resolves repository paths in both entry points", () => {
  for (const source of [false, true]) {
    const result = run(
      ["run", "explain this repository", "--repo", "../target repo"],
      source,
    );
    assert.equal(result.status, 0);
    assert.equal(
      result.stdout,
      `Task: explain this repository\nRepository: ${resolve("../target repo")}\n`,
    );
  }
});

test("repository defaults to the current directory", () => {
  const result = run(["run", "hello"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `Task: hello\nRepository: ${process.cwd()}\n`);
});

test("missing task, missing option value, and unknown command fail explicitly", () => {
  for (const args of [["run"], ["run", "hello", "--repo"], ["unknown"]]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /error:/);
    assert.equal(result.stdout, "");
  }
});

test("demo replays the scripted exchange and prints valid events", () => {
  const readable = run(["demo"]);
  assert.equal(readable.status, 0);
  assert.match(readable.stdout, /tool_result .*"content":"5"/);
  assert.match(
    readable.stdout,
    /run_finished {2}answered: "2 \+ 3 = 5\." .*cost unknown for 2 of 2 requests/,
  );

  const jsonl = run(["demo", "--jsonl"]);
  assert.equal(jsonl.status, 0);
  const events = jsonl.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events[0].type, "run_started");
  assert.equal(events.at(-1).type, "run_finished");
  assert.equal(events.at(-1).payload.result.state, "answered");
});

test("real models need an explicit harness key and exact provider/model", () => {
  const env = { ...process.env, ANTHROPIC_API_KEY: "sk-ant-ambient" };
  delete env.ANT_AGENT_ANTHROPIC_API_KEY;
  for (const [args, message] of [
    [
      ["demo", "--model", "anthropic/claude-haiku-5-5"],
      /set ANT_AGENT_ANTHROPIC_API_KEY/,
    ],
    [["demo", "--model", "openai/gpt-5"], /unsupported model/],
    [["demo", "--model", "claude-haiku-5-5"], /unsupported model/],
  ]) {
    const result = spawnSync(process.execPath, ["dist/cli.js", ...args], {
      cwd: root,
      encoding: "utf8",
      env,
      timeout: 10_000,
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /sk-ant-ambient/);
  }
});
