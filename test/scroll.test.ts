import assert from "node:assert/strict";
import test from "node:test";
import { clampScrollOffset } from "../src/scroll-adapter.ts";

test("clamps scroll offset to boundaries", () => {
  assert.equal(clampScrollOffset(-100, -50, 100), -50);
  assert.equal(clampScrollOffset(150, -50, 100), 100);
  assert.equal(clampScrollOffset(20, -50, 100), 20);
});

test("returns the minimum when the scroll range is invalid", () => {
  assert.equal(clampScrollOffset(20, 100, -100), 100);
});

test("returns the minimum when the offset is not finite", () => {
  assert.equal(clampScrollOffset(Number.NaN, -50, 100), -50);
});
