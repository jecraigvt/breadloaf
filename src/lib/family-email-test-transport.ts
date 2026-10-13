/** Local E2E mail sink; it cannot be pointed at an external SMTP host or a live database. */
export function localFamilyEmailTestTransport(env: Record<string, string | undefined> = process.env): { host: string; port: number } | null {
  if (!env.FAMILY_EMAIL_TEST_SMTP_PORT) return null;
  try {
    const app = new URL(env.APP_URL || "");
    const database = new URL(env.DATABASE_URL || "");
    const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    const port = Number(env.FAMILY_EMAIL_TEST_SMTP_PORT);
    if (!loopback(app.hostname) || !["http:", "https:"].includes(app.protocol) || app.username || app.password ||
      !loopback(database.hostname) || !["postgres:", "postgresql:"].includes(database.protocol) || !/_test$/i.test(database.pathname) ||
      !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local test transport");
    return { host: "127.0.0.1", port };
  } catch { throw new Error("Local email testing requires a loopback APP_URL, a loopback PostgreSQL database ending in _test, and a valid local SMTP port"); }
}
