import assert from "node:assert/strict";
import test from "node:test";
import { canRecordOnHub, isolateTileMicTap } from "./hub-mic";

test("the nested hub mic prevents both link navigation paths", () => {
  let prevented = false;
  let stopped = false;
  isolateTileMicTap({
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test("the homepage records only when microphone permission is already granted", () => {
  assert.equal(canRecordOnHub("granted"), true);
  assert.equal(canRecordOnHub("prompt"), false);
  assert.equal(canRecordOnHub("denied"), false);
  assert.equal(canRecordOnHub("unsupported"), false);
});
