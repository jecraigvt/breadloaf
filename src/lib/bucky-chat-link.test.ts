import assert from "node:assert/strict";
import test from "node:test";
import { resolveBuckyChatLink } from "./bucky-chat-link";

test("archive and other site links retain their item, query, and fragment", () => {
  for (const href of ["/documents/roof-minutes", "/maintenance?search=roof#entry-123", "/calendar"]) {
    assert.deepEqual(resolveBuckyChatLink(href), { kind: "internal", href });
  }
});

test("canonical Breadloaf URLs open the matching route on the current site", () => {
  for (const origin of ["https://breadloafhill.com", "https://www.breadloafhill.com", "http://breadloafhill.com"]) {
    assert.deepEqual(resolveBuckyChatLink(`${origin}/documents/roof?view=original#transcript`), {
      kind: "internal",
      href: "/documents/roof?view=original#transcript",
    });
  }
});

test("webpage URLs stay external, including lookalike hosts and nonstandard ports", () => {
  for (const href of [
    "https://www.weather.gov/btv/?q=Ripton#forecast",
    "https://breadloafhill.com.example.org/documents/roof",
    "https://breadloafhill.com:8443/documents/roof",
    "http://example.org/repair",
  ]) {
    assert.deepEqual(resolveBuckyChatLink(href), { kind: "external", href });
  }
});

test("unsafe schemes, ambiguous hosts, and browser-normalized URLs never become links", () => {
  for (const href of [
    undefined, "", " ", "javascript:alert(1)", "JaVaScRiPt:alert(1)",
    "data:text/html,hello", "vbscript:msgbox(1)", "file:///etc/passwd",
    "//example.org/roof", "/\\example.org/roof", "https:\\example.org/roof",
    "java\nscript:alert(1)", "https://example.org/\u0000roof",
    "https://breadloafhill.com@example.org/roof", "https://user:password@example.org/roof",
    "not-a-url", "mailto:test@example.org",
  ]) {
    assert.equal(resolveBuckyChatLink(href), null, `Rejected ${JSON.stringify(href)}`);
  }
});
