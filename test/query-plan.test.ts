import assert from "node:assert/strict";
import test from "node:test";
import { buildAmllQueryVariants } from "../src/lyrics/query-plan.ts";

test("builds full-artist, individual-artist and title-only AMLL query variants", () => {
  const variants = buildAmllQueryVariants({
    title: "使一颗心免于哀伤",
    artists: ["HOYO-MiX", "Chevy / 知更鸟"],
  });
  const keys = variants.map((item) => `${item.musicName}|${item.artistName || ""}`);
  assert.ok(keys.includes("使一颗心免于哀伤|HOYO-MiX / Chevy / 知更鸟"));
  assert.ok(keys.includes("使一颗心免于哀伤|HOYO-MiX"));
  assert.ok(keys.includes("使一颗心免于哀伤|Chevy"));
  assert.ok(keys.includes("使一颗心免于哀伤|知更鸟"));
  assert.ok(keys.includes("使一颗心免于哀伤|"));
});

test("does not duplicate query variants", () => {
  const variants = buildAmllQueryVariants({ title: "Song", artists: ["A", "A"] });
  const keys = variants.map((item) => `${item.musicName}|${item.artistName || ""}`);
  assert.equal(new Set(keys).size, keys.length);
});
