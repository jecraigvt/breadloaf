import { chromium } from "playwright";
import { createInterface } from "readline";

const EMAIL = "Breadloafhillsite@gmail.com";
const PASSWORD = "Delta!899";
const CALENDAR_NAME = "Breadloaf Hill Stays";
const CALENDAR_DESC =
  "Family visit calendar for Breadloaf Hill property - managed by breadloafhill.com";
const SERVICE_ACCOUNT =
  "breadloaf-hill@reader-7c045.iam.gserviceaccount.com";

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500, // slow enough to watch
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // ── Step A: Go to Google sign-in ──────────────────────────
  console.log("→ Navigating to Google sign-in...");
  await page.goto("https://accounts.google.com/signin", {
    waitUntil: "networkidle",
  });

  // ── Step B: Enter email ───────────────────────────────────
  console.log("→ Entering email...");
  await page.fill('input[type="email"]', EMAIL);
  await page.click("#identifierNext");
  await page.waitForTimeout(3000);

  // Enter password
  console.log("→ Entering password...");
  await page.waitForSelector('input[type="password"]', {
    state: "visible",
    timeout: 15000,
  });
  await page.fill('input[type="password"]', PASSWORD);
  await page.click("#passwordNext");
  await page.waitForTimeout(3000);

  // ── Step C: PAUSE for manual 2FA / CAPTCHA ────────────────
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  PAUSED — Handle any 2FA / CAPTCHA in the browser   ║");
  console.log("║  Once you're fully signed in, come back here.       ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  await prompt("Press ENTER when you are signed in and ready to continue...");

  // ── Step D: Navigate to Google Calendar ───────────────────
  console.log("→ Navigating to Google Calendar...");
  await page.goto("https://calendar.google.com", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  // ── Step E: Wait for calendar to fully load ───────────────
  console.log("→ Waiting for calendar to load...");
  // The main calendar grid or sidebar should appear
  await page.waitForSelector('[data-view-heading]', { timeout: 30000 }).catch(() => {
    console.log("  (calendar heading selector not found, waiting extra time)");
  });
  await page.waitForTimeout(5000);
  console.log("→ Calendar loaded.");

  // ── Step F: Create a new calendar ─────────────────────────
  console.log("→ Creating new calendar...");

  // Click the "+" next to "Other calendars"
  // The "+" button is an icon button near "Other calendars" in the sidebar
  const addButton = page.locator(
    '[aria-label="Create new calendar"], [aria-label="Add other calendars"]'
  );
  await addButton.first().click();
  await page.waitForTimeout(2000);

  // A dropdown/menu appears — click "Create new calendar"
  const createOption = page.getByText("Create new calendar");
  await createOption.click();
  await page.waitForTimeout(3000);

  // Fill in the calendar name
  console.log(`→ Entering calendar name: "${CALENDAR_NAME}"`);
  const nameInput = page.locator('input[aria-label="Name"], #calendar-name');
  if (await nameInput.count() === 0) {
    // Fallback: look for any text input on the create calendar page
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
  }
  await nameInput.first().fill(CALENDAR_NAME);
  await page.waitForTimeout(1000);

  // Fill in description
  console.log(`→ Entering description...`);
  const descInput = page.locator(
    'textarea[aria-label="Description"], #calendar-description, textarea'
  );
  await descInput.first().fill(CALENDAR_DESC);
  await page.waitForTimeout(1000);

  // Click "Create calendar" button
  console.log("→ Clicking 'Create calendar'...");
  const createButton = page.locator(
    'button:has-text("Create calendar"), [aria-label="Create calendar"]'
  );
  await createButton.first().click();
  await page.waitForTimeout(5000);
  console.log("→ Calendar created!");

  // ── Step G: Navigate to settings for the new calendar ─────
  console.log("→ Opening calendar settings...");

  // Go to calendar settings directly via URL (more reliable than clicking dots)
  await page.goto("https://calendar.google.com/calendar/r/settings", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Find and click the new calendar in the settings sidebar
  const calendarLink = page.getByText(CALENDAR_NAME, { exact: false });
  const calendarLinks = await calendarLink.all();
  console.log(`→ Found ${calendarLinks.length} matches for "${CALENDAR_NAME}" in settings`);

  // Click the one in the left sidebar navigation
  for (const link of calendarLinks) {
    const text = await link.textContent();
    if (text?.trim() === CALENDAR_NAME) {
      await link.click();
      break;
    }
  }
  await page.waitForTimeout(3000);

  // ── Step H: Share with service account ────────────────────
  console.log(`→ Sharing with service account: ${SERVICE_ACCOUNT}`);

  // Look for "Share with specific people or groups" section
  // Then click "Add people and groups"
  const addPeople = page.getByText("Add people and groups", { exact: false });
  if ((await addPeople.count()) > 0) {
    await addPeople.first().click();
  } else {
    // Try the "+" button in the sharing section
    const shareAdd = page.locator(
      '[aria-label="Add people and groups"], [aria-label="Add people"]'
    );
    await shareAdd.first().click();
  }
  await page.waitForTimeout(2000);

  // Enter the service account email in the dialog
  const emailInput = page.locator(
    'input[type="email"], input[aria-label*="email"], input[aria-label*="people"], input[type="text"]'
  );
  // The sharing dialog usually has a text/email input
  const inputs = await emailInput.all();
  // Use the last visible input (usually the one in the dialog)
  for (const input of inputs.reverse()) {
    if (await input.isVisible()) {
      await input.fill(SERVICE_ACCOUNT);
      break;
    }
  }
  await page.waitForTimeout(2000);

  // Press Enter to confirm the email
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  // Set permission to "Make changes to events"
  console.log('→ Setting permission to "Make changes to events"...');
  const permDropdown = page.locator(
    'select, [role="listbox"], [aria-label*="Permission"], [aria-label*="permission"]'
  );
  if ((await permDropdown.count()) > 0) {
    // Try clicking the dropdown
    await permDropdown.first().click();
    await page.waitForTimeout(1000);
    // Select "Make changes to events"
    const makeChanges = page.getByText("Make changes to events");
    if ((await makeChanges.count()) > 0) {
      await makeChanges.first().click();
    }
  }
  await page.waitForTimeout(1000);

  // Click Send
  console.log('→ Clicking "Send"...');
  const sendButton = page.locator(
    'button:has-text("Send"), [aria-label="Send"]'
  );
  await sendButton.first().click();
  await page.waitForTimeout(3000);
  console.log("→ Shared successfully!");

  // ── Step I: Get the Calendar ID ───────────────────────────
  console.log("→ Looking for Calendar ID...");

  // Scroll down to "Integrate calendar" section
  // The Calendar ID is displayed as text on the settings page
  const pageContent = await page.content();

  // Look for the Calendar ID pattern (usually an email-like string ending in @group.calendar.google.com)
  const calIdMatch = pageContent.match(
    /([a-zA-Z0-9]+@group\.calendar\.google\.com)/
  );
  if (calIdMatch) {
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log(`║  CALENDAR_ID: ${calIdMatch[1]}`);
    console.log("╚══════════════════════════════════════════════════════╝\n");
  } else {
    console.log("⚠ Could not auto-detect Calendar ID from page HTML.");
    console.log("→ Scrolling to Integrate calendar section...");

    // Try scrolling down and looking for it
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Try to find it in visible text
    const integrateSection = page.getByText("Integrate calendar");
    if ((await integrateSection.count()) > 0) {
      await integrateSection.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
    }

    // Re-check page content after scroll
    const updatedContent = await page.content();
    const retryMatch = updatedContent.match(
      /([a-zA-Z0-9]+@group\.calendar\.google\.com)/
    );
    if (retryMatch) {
      console.log("\n╔══════════════════════════════════════════════════════╗");
      console.log(`║  CALENDAR_ID: ${retryMatch[1]}`);
      console.log("╚══════════════════════════════════════════════════════╝\n");
    } else {
      console.log("⚠ Calendar ID not found automatically.");
      console.log("  Please find it manually under 'Integrate calendar' in settings.");
    }
  }

  // ── Step J: Take a screenshot ─────────────────────────────
  const screenshotPath = "scripts/calendar-settings-confirmation.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`→ Screenshot saved to: ${screenshotPath}`);

  // Keep the browser open so user can verify
  console.log("\n→ Done! Browser will stay open for verification.");
  await prompt("Press ENTER to close the browser...");
  await browser.close();
})();
