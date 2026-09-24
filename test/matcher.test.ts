import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMatch, normalizeSongKey } from "../src/matcher.ts";

test("accepts an exact title, artist and duration match", () => {
  const result = evaluateMatch(
    { title: "夜曲", artist: "周杰伦", durationMs: 227_000 },
    { title: "夜曲", artist: "周杰伦", durationMs: 228_000 },
  );
  assert.equal(result.qualified, true);
  assert.ok(result.combined >= 0.75);
});

test("rejects a mismatched title", () => {
  const result = evaluateMatch(
    { title: "晴天", artist: "周杰伦", durationMs: 269_000 },
    { title: "稻香", artist: "周杰伦", durationMs: 269_000 },
  );
  assert.equal(result.qualified, false);
  assert.equal(result.titlePass, false);
});

test("rejects durations outside the five second tolerance", () => {
  const result = evaluateMatch(
    { title: "晴天", artist: "周杰伦", durationMs: 269_000 },
    { title: "晴天", artist: "周杰伦", durationMs: 274_500 },
  );
  assert.equal(result.durationPass, false);
  assert.equal(result.qualified, false);
});

test("allows artist order and separator differences", () => {
  const result = evaluateMatch(
    { title: "珊瑚海", artist: "周杰伦 / 梁心颐", durationMs: 257_000 },
    { title: "珊瑚海", artist: "梁心颐、周杰伦", durationMs: 257_000 },
  );
  assert.equal(result.artistPass, true);
  assert.equal(result.qualified, true);
});

test("allows one or two extra featured artists", () => {
  const result = evaluateMatch(
    { title: "Something", artist: "A" },
    { title: "Something", artist: "A feat. B, C" },
  );
  assert.equal(result.artistPass, true);
});

test("rejects too many unmatched artists", () => {
  const result = evaluateMatch(
    { title: "Something", artist: "A" },
    { title: "Something", artist: "A / B / C / D" },
  );
  assert.equal(result.artistPass, false);
  assert.equal(result.qualified, false);
});

test("builds a stable cache key from title, artist and duration", () => {
  assert.equal(normalizeSongKey({ title: "晴天", artist: "周杰伦", durationMs: 269_000 }), "晴天|周杰伦|269");
});
