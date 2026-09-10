import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessageContent } from "../components/bucky/chat-message-content";

function render(content: string) {
  return renderToStaticMarkup(createElement(ChatMessageContent, { content }));
}

test("chat replies render readable formatting and both Markdown and bare webpage links", () => {
  const html = render("**Roof update**\n\n- [Original minutes](/documents/roof-minutes)\n- Forecast: https://www.weather.gov/btv/");
  assert.match(html, /<strong>Roof update<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /href="\/documents\/roof-minutes"/);
  assert.match(html, /href="https:\/\/www.weather.gov\/btv\/"/);
  assert.equal((html.match(/target="_blank"/g) || []).length, 2);
  assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length, 2);
  assert.equal((html.match(/opens in a new tab/g) || []).length, 2);
});

test("chat replies cannot inject HTML, execute URL schemes, or load tracking images", () => {
  const html = render([
    '<script>alert("bad")</script>',
    '[Unsafe](javascript:alert%281%29)',
    '[Unsafe HTML](data:text/html,hello)',
    '![Roof photo](https://example.org/tracking.gif)',
    '<iframe src="https://example.org"></iframe>',
  ].join("\n\n"));
  assert.doesNotMatch(html, /<(script|iframe|img|a)[\s>]/);
  assert.doesNotMatch(html, /javascript:|data:text\/html|tracking\.gif/);
  assert.match(html, /Unsafe/);
  assert.match(html, /Roof photo/);
});
