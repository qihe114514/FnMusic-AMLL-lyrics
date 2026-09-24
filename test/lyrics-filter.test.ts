import assert from "node:assert/strict";
import test from "node:test";
import { filterSongMetadataLines, normalizeLyrics, parseLyricText } from "../src/shared.ts";

function texts(lines: { words: { word: string }[] }[]) {
  return lines.map((line) => line.words.map((word) => word.word).join(""));
}

test("removes timed credit lines and keeps the lyric body", () => {
  const input = [
    "[00:00.000]词：東京真中/Piper Gubman/Adam Gubman",
    "[00:01.000]曲：東京真中",
    "[00:02.000]曲：東京真中",
    "[00:03.000]出品：鸣潮先约电台",
    "[00:04.000]这是正文",
    "[00:05.000]第二句正文",
  ].join("\n");
  assert.deepEqual(texts(parseLyricText(input, "lrc")), ["这是正文", "第二句正文"]);
});

test("removes structured credit lines and section markers", () => {
  const lines = [
    { text: "词：東京真中", startTime: 0, endTime: 1000 },
    { text: "作曲 : 東京真中", startTime: 1000, endTime: 2000 },
    { text: "[Chorus]", startTime: 2000, endTime: 3000 },
    { text: "正文一", startTime: 3000, endTime: 4000 },
  ];
  assert.deepEqual(texts(normalizeLyrics(lines)), ["正文一"]);
});

test("keeps a pure instrumental notice when it is the only content", () => {
  assert.deepEqual(texts(parseLyricText("[00:00.000]纯音乐，请欣赏", "lrc")), ["纯音乐，请欣赏"]);
});

test("removes song title and artist metadata lines from the start", () => {
  const input = [
    "[00:00.000]DANCE FRUITS",
    "[00:01.000]Toosie Slide - Sped Up",
    "[00:02.000]Steve Void / Dance Fruits Music - Sped Up",
    "[00:03.000]Toosie Slide (Sped Up|Explicit) - Dance Fruits Music/Steve Void",
    "[00:04.000]Black leather glove",
    "[00:05.000]No sequins buckles on my",
  ].join("\n");
  const context = { title: "Toosie Slide (Sped Up|Explicit)", artist: "Dance Fruits Music / Steve Void", album: "DANCE FRUITS" };
  assert.deepEqual(texts(filterSongMetadataLines(parseLyricText(input, "lrc"), context)), ["Black leather glove", "No sequins buckles on my"]);
});

test("removes combined artist-title metadata lines", () => {
  const lines = [
    { text: "Montagem Coral", startTime: 0, endTime: 1000 },
    { text: "Young God - Montagem Coral", startTime: 1000, endTime: 2000 },
    { text: "正文歌词", startTime: 2000, endTime: 3000 },
  ];
  assert.deepEqual(texts(filterSongMetadataLines(normalizeLyrics(lines), { title: "Montagem Coral", artist: "Young God" })), ["正文歌词"]);
});

test("removes title with version suffix metadata lines", () => {
  const lines = [
    { text: "Lightning Moment (phonk) - phonk", startTime: 0, endTime: 1000 },
    { text: "正文歌词", startTime: 1000, endTime: 2000 },
  ];
  assert.deepEqual(texts(filterSongMetadataLines(normalizeLyrics(lines), { title: "Lightning Moment (phonk)", artist: "phonk" })), ["正文歌词"]);
});
