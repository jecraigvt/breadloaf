import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeVoiceHandoff,
  stageVoiceHandoff,
  type VoiceHandoffHost,
} from "./voice-handoff";

test("a completed hub recording crosses the route once and only for its token", () => {
  const host: VoiceHandoffHost = {};
  const file = { name: "Voice memo.m4a" } as File;
  const token = stageVoiceHandoff(file, host);

  assert.equal(consumeVoiceHandoff("wrong-token", host), null);
  assert.equal(consumeVoiceHandoff(token, host), file);
  assert.equal(consumeVoiceHandoff(token, host), null);
});
