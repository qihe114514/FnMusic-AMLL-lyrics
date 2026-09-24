import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlaybackClock } from "../src/playback-clock.ts";
import { lowFrequencyVolume } from "../src/audio-level.ts";

test("uses a fresh bridge anchor and interpolates while playing", () => {
  assert.deepEqual(resolvePlaybackClock({
    now: 1_500,
    bridge: { currentTimeMs: 1_000, observedAt: 1_000, playing: true },
    fallback: { currentTimeMs: 0, playing: false },
  }), { currentTimeMs: 1_500, playing: true });
});

test("keeps a paused bridge anchor fixed", () => {
  assert.deepEqual(resolvePlaybackClock({
    now: 1_500,
    bridge: { currentTimeMs: 1_000, observedAt: 1_000, playing: false },
    fallback: { currentTimeMs: 0, playing: true },
  }), { currentTimeMs: 1_000, playing: false });
});

test("falls back to the page player state when the bridge is stale", () => {
  assert.deepEqual(resolvePlaybackClock({
    now: 2_001,
    bridge: { currentTimeMs: 1_000, observedAt: 1_000, playing: true },
    fallback: { currentTimeMs: 2_250, playing: true },
  }), { currentTimeMs: 2_250, playing: true });
});

test("accepts an immediate seek anchor", () => {
  assert.deepEqual(resolvePlaybackClock({
    now: 1_010,
    bridge: { currentTimeMs: 9_000, observedAt: 1_000, playing: true },
    fallback: { currentTimeMs: 0, playing: false },
  }), { currentTimeMs: 9_010, playing: true });
});

test("low frequency volume uses the configured 80-120Hz bins", () => {
  const data = new Uint8Array(128);
  data[3] = 255;
  data[4] = 255;
  data[5] = 255;
  data[6] = 255;
  assert.equal(lowFrequencyVolume(data, 44100, 2048), 1);
});

test("invalid audio data falls back to the neutral background level", () => {
  assert.equal(lowFrequencyVolume([], 44100, 2048), 1);
});
