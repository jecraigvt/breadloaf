import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { changedPatchPaths } from "../src/lib/bucky-publish-policy";

async function main() {
  const artifact = JSON.parse(await readFile(process.env.BUCKY_RESULT_PATH || "bucky-result.json", "utf8"));
  const paths = changedPatchPaths(artifact.result.patch);
  const routes = new Set(["/", "/login", "/family", "/more"]);
  for (const file of paths) {
    const match = /^src\/app\/(.*)\/page\.tsx$/.exec(file);
    if (match && !/[\[\](]/.test(match[1])) routes.add(`/${match[1]}`);
  }
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport });
      const login = await context.request.post("http://localhost:3000/api/auth", { data: { pin: "2468" } });
      assert.equal(login.status(), 200, "Test family can sign in");
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // Code under test has no outbound browser access or production credentials.
      await page.route("**/*", (route) => new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort());
      for (const route of Array.from(routes)) {
        const response = await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
        assert.ok(response && response.status() < 400, `${route} renders successfully`);
        assert.ok(await page.locator("body").innerText(), `${route} has visible content`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, `${route} does not overflow horizontally`);
        assert.equal(errors.length, 0, `${route} has no browser runtime errors: ${errors.join("; ")}`);
      }
      await context.close();
    }
  } finally { await browser.close(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
