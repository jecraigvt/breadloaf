import { test } from "node:test";
import assert from "node:assert/strict";
import { changedPatchPaths, isDevelopmentPath, publishingDecision } from "./bucky-publish-policy";
function patch(file: string, added = "color: red;") { return `diff --git a/${file} b/${file}\nindex abcdef0..1234567 100644\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-color: blue;\n+${added}\n`; }
test("publishing gate rejects protected paths and patch header tricks", () => {
  for (const file of [".github/workflows/test.yml", "package.json", "src/middleware.ts", "src/lib/ai.ts", "src/app/api/auth/route.ts", "src/components/../../middleware.ts"])
    assert.equal(isDevelopmentPath(file), false, file);
  assert.throws(() => changedPatchPaths(patch("src/app/globals.css").replace("+++ b/src/app/globals.css", "+++ b/package.json")));
  assert.throws(() => changedPatchPaths(patch("src/app/globals.css") + "new mode 100755\n"));
});
test("automatic presentation changes cannot add remote resources or code", () => {
  assert.equal(publishingDecision(patch("src/app/globals.css")).automatic, true);
  assert.equal(publishingDecision(patch("src/app/globals.css", "background: url(https://example.com);")).automatic, false);
  assert.equal(publishingDecision(patch("src/components/layout/masthead.tsx", "text")).automatic, false);
  assert.equal(publishingDecision("").automatic, false);
});
