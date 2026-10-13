import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCodexRuntime } from "./bucky-codex-runtime";

test("a replaced desktop runtime resolves the new native executable without changing custom paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "breadloaf-runtime-"));
  try {
    const old = path.join(root, "11111111", "codex.exe");
    const current = path.join(root, "22222222", "codex.exe");
    await mkdir(path.dirname(old)); await mkdir(path.dirname(current));
    await writeFile(old, "old"); await writeFile(current, "current");
    await utimes(old, 1, 1); await utimes(current, 2, 2);
    const options = { platform: "win32" as const, appBinRoot: root, searchPath: "" };
    assert.equal(await resolveCodexRuntime(old, options), current);
    await rm(old);
    assert.equal(await resolveCodexRuntime(old, options), current);
    assert.equal(await resolveCodexRuntime("codex", options), current);
    assert.equal(await resolveCodexRuntime(path.join(tmpdir(), "custom-missing-codex.exe"), options), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
