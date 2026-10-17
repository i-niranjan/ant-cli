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
