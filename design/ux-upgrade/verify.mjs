import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = new URL(process.env.UX_PREVIEW_URL || "http://127.0.0.1:4178");
assert.ok(["127.0.0.1", "localhost", "::1"].includes(base.hostname), "Verify only a loopback preview");
const artifacts = path.join(path.dirname(fileURLToPath(import.meta.url)), "artifacts");
const concepts = ["cabin", "fieldguide", "homestead"];
const screens = ["hub", "calendar", "rooms", "bucky", "upload", "tasks"];
const report = { origin: base.origin, checks: [], screenshots: [], failures: [], outbound: [], apiCalls: [], browserErrors: [], failedResources: [] };

function rawRequest(requestPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: base.hostname, port: base.port, path: requestPath, method }, (response) => {
      let bytes = 0;
      response.on("data", (chunk) => { bytes += chunk.length; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, bytes }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function check(name, action) {
  try {
    await action();
    report.checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    report.failures.push({ name, message: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function noOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width + 2) return [];
    return [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && style.position !== "fixed" && (rect.right > width + 2 || rect.left < -2);
    }).slice(0, 6).map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
  });
  assert.deepEqual(overflow, [], `${label}: horizontal overflow at ${overflow.join(", ")}`);
}

async function screenshot(page, name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true, animations: "disabled" });
  report.screenshots.push(filename);
}

async function gotoScreen(page, concept, screen) {
  const response = await page.goto(`${base.origin}/prototype.html?concept=${concept}&screen=${screen}`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `${concept}/${screen} loads`);
  assert.ok((await page.locator("body").innerText()).trim().length > 100, "Screen has meaningful visible content");
  await page.evaluate(() => document.fonts.ready);
}

async function navigation(page) {
  const matches = await page.locator("nav").evaluateAll((navs) => navs.map((nav) => [...nav.querySelectorAll("a, button")].map((item) => item.textContent.trim().replace(/\s+/g, " "))));
  assert.ok(matches.some((items) => JSON.stringify(items) === JSON.stringify(["Hub", "Dates", "Rooms", "Guide", "Board"])), `Familiar navigation in exact order; found ${JSON.stringify(matches)}`);
}

async function keyboardFocus(page) {
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return { tag: element.tagName, visible: element.getBoundingClientRect().width > 0, outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== "none" };
  });
  assert.ok(focus.tag !== "BODY" && focus.visible && (focus.outline || focus.shadow), "Keyboard focus is visible");
}

async function stayJourney(page, concept) {
  await gotoScreen(page, concept, "calendar");
  const open = page.locator('[data-action="stay-open"]').first();
  await open.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const initialFocusInDialog = await dialog.evaluate((element) => element.contains(document.activeElement));
  assert.ok(initialFocusInDialog, "Dialog receives keyboard focus");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await open.evaluate((element) => element === document.activeElement), "Escape restores focus to the Add Stay button");
  await open.click();
  const guestName = `Preview Visitor ${concept}`;
  await page.locator("#guest-name").fill(guestName);
  await page.locator("#check-in").fill("2026-09-18");
  await page.locator("#check-out").fill("2026-09-17");
  await page.locator("#stay-notes").fill("Synthetic preview only. Two guests arriving after dinner.");
  assert.equal(await page.locator("#room-preference").count(), 1, "Optional room preference is retained");
  const statuses = await page.locator("#stay-status option").evaluateAll((options) => options.map((option) => option.value));
  assert.deepEqual(statuses, ["confirmed", "tentative", "requested"], "Existing stay statuses are retained");
  await page.locator('[data-action="stay-save"]').click();
  assert.ok(await dialog.isVisible(), "An end date before arrival cannot save a stay");
  await page.locator("#check-out").fill("2026-09-21");
  await page.locator("#stay-status").selectOption("tentative");
  await page.locator('[data-action="stay-save"]').click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText(guestName, { exact: false }).first().waitFor({ state: "visible" });
  await noOverflow(page, `${concept} saved stay`);
  await screenshot(page, `${concept}-stay-confirmation-390`);
}

async function uploadJourney(page, concept) {
  await gotoScreen(page, concept, "upload");
  await page.locator('[data-action="sample-file"]').click();
  await page.locator('[data-action="upload-background"]').waitFor({ state: "visible" });
  assert.ok(await page.getByRole("button", { name: "Upload & Analyze", exact: true }).isVisible(), "Immediate analysis remains available");
  await page.locator('[data-action="upload-background"]').click();
  await page.getByText(/original saved/i).first().waitFor({ state: "visible" });
  await screenshot(page, `${concept}-upload-confirmation-390`);
  await page.locator('[data-screen="tasks"]').first().click();
  await page.locator('[data-task-state="waiting"]').first().waitFor({ state: "visible" });
  await page.locator('[data-action="task-progress"]').first().click();
  await page.locator('[data-task-state="running"]').first().waitFor({ state: "visible" });
  await page.locator('[data-action="task-error"]').first().click();
  await page.locator('[data-task-state="error"]').first().waitFor({ state: "visible" });
  await screenshot(page, `${concept}-task-error-390`);
  await page.locator('[data-action="task-retry"]').first().click();
  await page.locator('[data-task-state="waiting"]').first().waitFor({ state: "visible" });
  await page.locator('[data-action="task-progress"]').first().click();
  await page.locator('[data-task-state="running"]').first().waitFor({ state: "visible" });
  await page.locator('[data-action="task-progress"]').first().click();
  await page.locator('[data-task-state="complete"]').first().waitFor({ state: "visible" });
  await screenshot(page, `${concept}-task-complete-390`);
}

async function familiarControls(page, concept) {
  await gotoScreen(page, concept, "calendar");
  await page.locator('[data-action="view-list"]').click();
  assert.equal(await page.locator('[data-action="view-list"]').getAttribute("aria-pressed"), "true");
  await page.locator('[data-action="view-month"]').click();
  assert.equal(await page.locator('[data-action="view-month"]').getAttribute("aria-pressed"), "true");
  const monthHeading = page.locator(".calendar-toolbar h2");
  const initialMonth = await monthHeading.innerText();
  await page.locator('[data-action="month-next"]').click();
  assert.notEqual(await monthHeading.innerText(), initialMonth, "Calendar can move to the next month");
  await page.locator('[data-action="month-prev"]').click();
  assert.equal(await monthHeading.innerText(), initialMonth, "Calendar can return to the previous month");
  const guide = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Guide", exact: true });
  await guide.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Beyond this design preview", { exact: true }).waitFor({ state: "visible" });
  for (let step = 0; step < 5; step++) {
    await page.keyboard.press("Tab");
    assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)), "Dialog traps keyboard focus");
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await guide.evaluate((element) => element === document.activeElement), "Out-of-coverage dialog returns focus to familiar navigation");

  await gotoScreen(page, concept, "upload");
  await page.locator("#archive-file").setInputFiles({ name: "Fictional preview note.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic design preview only. No family information.") });
  await page.getByText("Fictional preview note.txt", { exact: true }).waitFor({ state: "visible" });
  await page.locator("#uploaded-by").fill("Preview visitor");
  await page.locator('[data-action="upload-now"]').click();
  await page.getByText("Analysis ready", { exact: true }).waitFor({ state: "visible" });
  await screenshot(page, `${concept}-immediate-analysis-390`);
}

await mkdir(artifacts, { recursive: true });
await check("Static preview responds to GET and HEAD", async () => {
  const get = await rawRequest("/");
  assert.equal(get.status, 200);
  assert.ok(get.bytes > 0);
  const head = await rawRequest("/prototype.html", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.bytes, 0);
});
await check("Static preview refuses writes, API routes, and private paths", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) assert.ok([403, 405].includes((await rawRequest("/", method)).status), `${method} rejected`);
  for (const location of ["/.env", "/.git/config", "/api/auth", "/api/bucky/jobs", "/../package.json", "/%2e%2e/package.json", "/%2e%2e/%2e%2e/.env", "/..%5c..%5c.env"]) {
    assert.ok([400, 403, 404].includes((await rawRequest(location)).status), `${location} is inaccessible`);
  }
});

const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }, { width: 320, height: 720 }, { width: 768, height: 1024 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => report.browserErrors.push({ url: page.url(), message: error.message }));
    page.on("response", (response) => {
      if (response.status() >= 400) report.failedResources.push({ url: response.url(), status: response.status() });
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!new Set(["data:", "blob:", "about:"]).has(url.protocol) && url.origin !== base.origin) {
        report.outbound.push({ method: request.method(), url: url.href });
        return route.abort();
      }
      if (url.pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method())) {
        report.apiCalls.push({ method: request.method(), url: url.href });
        return route.abort();
      }
      return route.continue();
    });
    if ([390, 1440].includes(viewport.width)) {
      await check(`Comparison at ${viewport.width}px`, async () => {
        assert.equal((await page.goto(base.origin, { waitUntil: "networkidle" }))?.status(), 200);
        await noOverflow(page, "Comparison");
        await keyboardFocus(page);
        await screenshot(page, `comparison-${viewport.width}`);
      });
      await check(`Comparison concept, screen and viewport controls at ${viewport.width}px`, async () => {
        await page.locator("#screen-select").selectOption("calendar");
        const compareUrls = await page.locator("[data-preview-concept]").evaluateAll((frames) => frames.map((frame) => frame.src));
        assert.equal(compareUrls.length, 3, "All three directions can be compared together");
        assert.ok(compareUrls.every((url) => new URL(url).searchParams.get("screen") === "calendar"), "Comparison follows the same screen in all concepts");
        await page.locator("#explore-mode").click();
        await page.locator("#concept-select").selectOption("fieldguide");
        await page.locator("#screen-select").selectOption("tasks");
        await page.locator('[data-viewport="desktop"]').click();
        const focused = page.locator("#focused-preview");
        const url = new URL(await focused.getAttribute("src"), base);
        assert.equal(url.searchParams.get("concept"), "fieldguide");
        assert.equal(url.searchParams.get("screen"), "tasks");
        const child = page.frameLocator("#focused-preview");
        await child.locator('[data-task-state="waiting"]').waitFor({ state: "visible" });
        await child.locator('[data-action="task-progress"]').click();
        await child.locator('[data-task-state="running"]').waitFor({ state: "visible" });
        for (const [device, width] of [["mobile", 390], ["tablet", 768], ["desktop", 1440]]) {
          await page.locator(`[data-viewport="${device}"]`).click();
          await page.waitForFunction((expected) => document.querySelector("#focused-preview").contentWindow.innerWidth === expected, width);
          assert.ok(await child.locator('[data-task-state="running"]').isVisible(), "Changing viewport preserves the active demo journey");
        }
        await noOverflow(page, "Desktop preview in comparison shell");
        await screenshot(page, `exploration-desktop-at-${viewport.width}`);
        await child.locator('[data-screen="upload"]').first().click();
        await page.waitForFunction(() => document.querySelector("#screen-select").value === "upload");
        assert.equal(new URL(page.url()).searchParams.get("screen"), "upload", "Navigation inside the preview updates comparison controls and URL");
      });
    }
    for (const concept of concepts) {
      const testedScreens = [390, 1440].includes(viewport.width) ? screens : ["hub", "calendar", "upload"];
      for (const screen of testedScreens) {
        await check(`${concept}/${screen} at ${viewport.width}px`, async () => {
          await gotoScreen(page, concept, screen);
          await noOverflow(page, `${concept}/${screen}`);
          await navigation(page);
          if (screen === "hub") await keyboardFocus(page);
          const missingImages = await page.locator("img").evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.getAttribute("src")));
          assert.deepEqual(missingImages, [], "All property images load");
          await screenshot(page, `${concept}-${screen}-${viewport.width}`);
        });
      }
      if (viewport.width === 390) {
        await check(`${concept}: visit form, validation, save, Escape and focus return`, () => stayJourney(page, concept));
        await check(`${concept}: original saved, waiting, error, retry and completion`, () => uploadJourney(page, concept));
        await check(`${concept}: familiar controls, dialog focus trap and immediate analysis`, () => familiarControls(page, concept));
      }
      if ([320, 768].includes(viewport.width)) {
        await check(`${concept}: open visit form fits ${viewport.width}px`, async () => {
          await gotoScreen(page, concept, "calendar");
          await page.locator('[data-action="stay-open"]').first().click();
          await page.getByRole("dialog").waitFor({ state: "visible" });
          await noOverflow(page, "Visit form");
          await screenshot(page, `${concept}-stay-form-${viewport.width}`);
        });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await check("No unexpected outbound requests, API calls, or browser errors", async () => {
  assert.deepEqual(report.outbound, [], "All browser assets remain on the static loopback server");
  assert.deepEqual(report.apiCalls, [], "Prototype never calls an API or submits a request");
  assert.deepEqual(report.browserErrors, [], "All screens and journeys are free of browser exceptions");
  assert.deepEqual(report.failedResources, [], "All requested static assets load successfully");
});
await writeFile(path.join(artifacts, "verification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`${report.checks.length} passed; ${report.failures.length} failed. Screenshots and report: ${artifacts}`);
if (report.failures.length) process.exitCode = 1;
