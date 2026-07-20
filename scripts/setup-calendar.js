const { chromium } = require("playwright");

const EMAIL = "Breadloafhillsite@gmail.com";
const PASSWORD = "Delta!899";
const CALENDAR_NAME = "Breadloaf Hill Stays";
const CALENDAR_DESC =
  "Family visit calendar for Breadloaf Hill property - managed by breadloafhill.com";
const SERVICE_ACCOUNT =
  "breadloaf-hill@reader-7c045.iam.gserviceaccount.com";

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // ── Step A: Go to Google sign-in ──────────────────────────
  console.log("→ Navigating to Google sign-in...");
  await page.goto("https://accounts.google.com/signin", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  // ── Step B: Enter email ───────────────────────────────────
  console.log("→ Entering email...");
  await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 15000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.click("#identifierNext");
  await page.waitForTimeout(5000);

  // ── Step C: PAUSE — sign in manually ──────────────────────
  // Google often shows CAPTCHAs, "verify it's you", or alternate layouts
  // for automated browsers. Safest to let the user handle the entire
  // sign-in from here (password + any 2FA).
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  PAUSED — Complete sign-in manually in the browser      ║");
  console.log("║                                                          ║");
  console.log("║  1. Enter the password if prompted                       ║");
  console.log("║  2. Handle any CAPTCHA / 2FA / security prompts          ║");
  console.log("║  3. Wait until you see your Google account page          ║");
  console.log("║  4. Click the green Resume (▶) in Playwright Inspector   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  await page.pause();

  // ── Step D: Navigate to Google Calendar ───────────────────
  console.log("→ Navigating to Google Calendar...");
  await page.goto("https://calendar.google.com", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  // ── Step E: Wait for calendar to fully load ───────────────
  console.log("→ Waiting for calendar to fully load...");
  await page.waitForTimeout(5000);
  // Wait for the sidebar to be present (contains "Other calendars")
  await page
    .waitForSelector('text="Other calendars"', { timeout: 30000 })
    .catch(() => console.log("  (sidebar text not found, continuing anyway)"));
  await page.waitForTimeout(2000);
  console.log("→ Calendar loaded.");

  // ── Step F: Create a new calendar ─────────────────────────
  console.log("→ Creating new calendar...");

  // Click the "+" next to "Other calendars"
  const addCalBtn = page.locator(
    '[aria-label="Create new calendar"], [aria-label="Add other calendars"]'
  );
  if ((await addCalBtn.count()) > 0) {
    await addCalBtn.first().click();
  } else {
    // Fallback: look for the "+" icon near "Other calendars"
    console.log("  → Trying fallback: looking for + icon near Other calendars...");
    const plusIcons = page.locator('[data-tooltip="Add other calendars"]');
    if ((await plusIcons.count()) > 0) {
      await plusIcons.first().click();
    }
  }
  await page.waitForTimeout(3000);

  // Click "Create new calendar" from the dropdown menu
  console.log("→ Selecting 'Create new calendar' from menu...");
  const createMenuItem = page.locator('text="Create new calendar"');
  await createMenuItem.waitFor({ state: "visible", timeout: 10000 });
  await createMenuItem.click();
  await page.waitForTimeout(5000);

  // Fill in the calendar name
  console.log(`→ Entering calendar name: "${CALENDAR_NAME}"`);
  // On the create calendar page, there's a name input
  const nameInput = page.locator('#calendar-name, input[data-name="name"], input[aria-label="Name"]');
  if ((await nameInput.count()) > 0) {
    await nameInput.first().fill(CALENDAR_NAME);
  } else {
    // Fallback: find any empty text input on the page
    console.log("  → Using fallback input selector...");
    const textInputs = page.locator('input[type="text"]');
    const count = await textInputs.count();
    for (let i = 0; i < count; i++) {
      const val = await textInputs.nth(i).inputValue();
      if (!val) {
        await textInputs.nth(i).fill(CALENDAR_NAME);
        break;
      }
    }
  }
  await page.waitForTimeout(2000);

  // Fill in description
  console.log("→ Entering description...");
  const descInput = page.locator('#calendar-description, textarea[aria-label="Description"], textarea');
  if ((await descInput.count()) > 0) {
    await descInput.first().fill(CALENDAR_DESC);
  }
  await page.waitForTimeout(2000);

  // Click "Create calendar" button
  console.log("→ Clicking 'Create calendar' button...");
  const createBtn = page.locator('button:has-text("Create calendar")');
  await createBtn.waitFor({ state: "visible", timeout: 10000 });
  await createBtn.click();
  await page.waitForTimeout(5000);
  console.log("→ Calendar created!");

  // ── Step G: Navigate to settings for the new calendar ─────
  console.log("→ Navigating to calendar settings...");
  await page.goto("https://calendar.google.com/calendar/r/settings", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  // Click the new calendar in the settings sidebar
  console.log(`→ Looking for "${CALENDAR_NAME}" in settings sidebar...`);
  const sidebarLink = page.locator(`text="${CALENDAR_NAME}"`);
  await sidebarLink.first().waitFor({ state: "visible", timeout: 15000 });
  await sidebarLink.first().click();
  await page.waitForTimeout(5000);

  // ── Step H: Share with service account ────────────────────
  console.log(`→ Sharing calendar with service account...`);
  console.log(`  ${SERVICE_ACCOUNT}`);

  // Find and click "Add people and groups"
  const addPeopleBtn = page.locator('text="Add people and groups"');
  await addPeopleBtn.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {
    console.log("  → 'Add people and groups' not immediately visible, scrolling...");
  });

  // Scroll down to find the sharing section
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) =>
      e.textContent?.includes("Share with specific people")
    );
    if (el) el.scrollIntoView({ behavior: "smooth" });
  });
  await page.waitForTimeout(2000);

  await addPeopleBtn.first().click();
  await page.waitForTimeout(3000);

  // Enter the service account email in the sharing dialog
  console.log("→ Entering service account email...");
  // The dialog usually has an input for email/people
  const shareInput = page.locator(
    '[aria-label*="Add people"], [aria-label*="email"], input[type="text"]'
  );
  // Get all visible inputs and use the one in the dialog
  const shareInputs = await shareInput.all();
  let filled = false;
  for (const input of shareInputs.reverse()) {
    if (await input.isVisible()) {
      await input.fill(SERVICE_ACCOUNT);
      filled = true;
      break;
    }
  }
  if (!filled) {
    console.log("  ⚠ Could not find email input — pausing for manual entry.");
    await page.pause();
  }
  await page.waitForTimeout(2000);

  // Press Enter to confirm the email autocomplete
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);

  // Set permission to "Make changes to events"
  console.log('→ Setting permission to "Make changes to events"...');
  // Look for a permission dropdown/select
  const permSelect = page.locator('[aria-label*="ermission"], [aria-label*="Permissions"], select');
  if ((await permSelect.count()) > 0) {
    await permSelect.first().click();
    await page.waitForTimeout(1500);

    const makeChangesOpt = page.locator('text="Make changes to events"');
    if ((await makeChangesOpt.count()) > 0) {
      await makeChangesOpt.first().click();
      await page.waitForTimeout(1500);
    } else {
      console.log('  ⚠ Could not find "Make changes to events" option — pausing.');
      await page.pause();
    }
  } else {
    console.log("  ⚠ Could not find permission dropdown — pausing for manual selection.");
    await page.pause();
  }

  // Click Send
  console.log('→ Clicking "Send"...');
  const sendBtn = page.locator('button:has-text("Send")');
  await sendBtn.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {
    console.log("  → Send button not visible, trying Enter key...");
  });
  if ((await sendBtn.count()) > 0 && (await sendBtn.first().isVisible())) {
    await sendBtn.first().click();
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(5000);
  console.log("→ Shared successfully!");

  // ── Step I: Get the Calendar ID ───────────────────────────
  console.log("→ Looking for Calendar ID...");

  // Scroll to "Integrate calendar" section
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) =>
      e.textContent?.includes("Integrate calendar")
    );
    if (el) el.scrollIntoView({ behavior: "smooth" });
  });
  await page.waitForTimeout(3000);

  // Extract Calendar ID from page content
  const pageContent = await page.content();
  const calIdMatch = pageContent.match(
    /([a-zA-Z0-9_]+@group\.calendar\.google\.com)/
  );

  if (calIdMatch) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log(`║  CALENDAR_ID: ${calIdMatch[1]}`);
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
  } else {
    console.log("⚠ Could not auto-detect Calendar ID from page HTML.");
    console.log("→ Pausing so you can find it manually under 'Integrate calendar'.");
    await page.pause();
  }

  // ── Step J: Take a screenshot ─────────────────────────────
  const screenshotPath = "scripts/calendar-settings-confirmation.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`→ Screenshot saved to: ${screenshotPath}`);

  // Final pause so user can verify everything
  console.log("");
  console.log("→ Done! Browser is still open for verification.");
  console.log("→ Click Resume (▶) in the Playwright Inspector to close.");
  await page.pause();

  await browser.close();
  console.log("→ Browser closed. All done!");
})();
