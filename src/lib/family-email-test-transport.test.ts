import assert from "node:assert/strict";
import test from "node:test";
import { localFamilyEmailTestTransport } from "./family-email-test-transport";

const local = { APP_URL: "http://127.0.0.1:3000", DATABASE_URL: "postgresql://fixture@127.0.0.1:55438/breadloaf_test", FAMILY_EMAIL_TEST_SMTP_PORT: "12525" };

test("local SMTP cannot be enabled for a live origin, database, or external host", () => {
  assert.equal(localFamilyEmailTestTransport({}), null);
  assert.deepEqual(localFamilyEmailTestTransport(local), { host: "127.0.0.1", port: 12525 });
  for (const changes of [
    { APP_URL: "https://breadloafhill.com" }, { APP_URL: "http://127.0.0.1.attacker.example" },
    { DATABASE_URL: "postgresql://fixture@production.example/breadloaf_test" },
    { DATABASE_URL: "postgresql://fixture@127.0.0.1:55438/breadloaf" },
    { FAMILY_EMAIL_TEST_SMTP_PORT: "0" }, { FAMILY_EMAIL_TEST_SMTP_PORT: "invalid" },
  ]) assert.throws(() => localFamilyEmailTestTransport({ ...local, ...changes }));
});
