import type { LyricLine as CoreLyricLine } from "@applemusic-like-lyrics/core";
import { parseLrc, parseQrc, parseTTML, parseYrc, stringifyTTML, type LyricLine as ParsedLyricLine } from "@applemusic-like-lyrics/lyric";
import { inflate } from "pako";

export type LyricLine = CoreLyricLine;
export type LyricFormat = "ttml" | "lrc" | "qrc" | "yrc" | "krc" | "text";
export type Song = { title: string; artist?: string; album?: string; guid?: string };
type RawRecord = Record<string, unknown>;

const krcKey = Uint8Array.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105]);

export function parseLyricText(input: string, format?: LyricFormat): LyricLine[] {
  const raw = input.trim();
  const text = format === "ttml" || raw.startsWith("<") ? raw : cleanLyricSource(raw);
  if (!text) return [];
  try {
    if (!format || format === "text" || format === "lrc") {
      const timestamped = parseFeiniuTimestamped(text);
      if (timestamped.length) return timestamped;
    }
    if (format === "krc" || text.startsWith("krc1")) return mergeParallelLines(parseKrc(decodeKrc(text)));
    if (format === "qrc") return mergeParallelLines(normalizeParsed(parseQrc(text)));
    if (format === "yrc") return mergeParallelLines(normalizeParsed(parseYrc(text)));
    if (format === "ttml" || text.startsWith("<")) return normalizeParsed(parseTTML(text).lines);
    if (format === "text") return makePlainTextLines(text);
    return mergeParallelLines(normalizeParsed(parseLrc(text)));
  } catch {
    return [];
  }
}

/** Convert AMLL's line model to the official AMLL TTML wire format. */
export function linesToTtml(lines: LyricLine[]): string {
  return stringifyTTML({ lines: lines.map((line) => ({
    ...line,
    words: line.words.map((word) => ({ ...word })),
  })), metadata: [] });
}

export function normalizeLyrics(value: unknown, format?: LyricFormat): LyricLine[] {
  if (typeof value === "string") return parseLyricText(value, format);
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    const structured = value.map((item) => item && typeof item === "object" ? normalizeStructuredLine(item as RawRecord) : null).filter((item): item is LyricLine => !!item);
    if (structured.length) return mergeParallelLines(structured);
    const text = value.find((item): item is string => typeof item === "string" && isLyricText(item));
    if (text) return parseLyricText(text, format);
    for (const item of value) {
      const parsed = normalizeLyrics(item, format);
      if (parsed.length) return parsed;
    }
    return [];
  }

  const record = value as RawRecord;
  const structured = normalizeStructuredLine(record);
  if (structured) return [structured];
  const data = record.data && typeof record.data === "object" ? record.data as RawRecord : record;
  const list = Array.isArray(data.list) ? data.list : [];
  const preferred = typeof data.preferred === "string" ? data.preferred : "";
  const preferredItem = list.find((item) => item && typeof item === "object" && (item as RawRecord).guid === preferred);
  const lyricItem = preferredItem || list.find((item) => item && typeof item === "object" && (typeof (item as RawRecord).content === "string" || Array.isArray((item as RawRecord).lines) || Array.isArray((item as RawRecord).lyrics)));
  if (lyricItem && typeof lyricItem === "object") {
    const item = lyricItem as RawRecord;
    const structuredLines = Array.isArray(item.lines) ? item.lines : Array.isArray(item.lyrics) ? item.lyrics : null;
    if (structuredLines) {
      const parsed = structuredLines.map((line) => line && typeof line === "object" ? normalizeStructuredLine(line as RawRecord) : null).filter((line): line is LyricLine => !!line);
      if (parsed.length) return mergeParallelLines(parsed);
    }
    const content = typeof item.content === "string" ? item.content : "";
    if (content) {
      const parsed = parseLyricText(content, item.isLRC === true ? "lrc" : format);
      const translationText = [item.translation, item.translatedLyric, item.tlyric].find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (parsed.length && translationText) {
        const translation = parseLyricText(translationText, "lrc");
        return translation.length ? mergeTranslation(parsed, translation) : parsed;
      }
      if (parsed.length) return parsed;
    }
  }

  for (const key of ["content", "ttml", "qrc", "yrc", "krc", "lrc", "rawLyric", "text", "lyric", "lyrics"]) {
    const content = record[key];
    if (typeof content === "string" && isLyricText(content)) {
      const inferred = key === "ttml" ? "ttml" : key === "qrc" ? "qrc" : key === "yrc" ? "yrc" : key === "krc" ? "krc" : key === "lrc" ? "lrc" : undefined;
      return parseLyricText(content, inferred);
    }
  }
  for (const key of ["lyrics", "lyric", "list", "lines", "result", "data"]) {
    const parsed = normalizeLyrics(record[key], format);
    if (parsed.length) return parsed;
  }
  return [];
}

function normalizeStructuredLine(record: RawRecord): LyricLine | null {
  const safe = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const rawWords = Array.isArray(record.words) ? record.words : Array.isArray(record.syllables) ? record.syllables : Array.isArray(record.segments) ? record.segments : null;
  if (!rawWords && typeof record.text !== "string" && typeof record.content !== "string") return null;
  const lineStart = safe(record.startTime ?? record.start ?? record.time, 0);
  const lineEnd = safe(record.endTime ?? record.end, lineStart + safe(record.duration, 0));
  const words = rawWords ? rawWords.map((item) => {
    const word = item && typeof item === "object" ? item as RawRecord : {};
    const startTime = safe(word.startTime ?? word.start ?? word.time, lineStart);
    const endTime = safe(word.endTime ?? word.end, startTime + safe(word.duration, 0));
    const text = typeof word.word === "string" ? word.word : typeof word.text === "string" ? word.text : "";
    return { startTime: Math.round(startTime), endTime: Math.max(Math.round(startTime + 1), Math.round(endTime)), word: text };
  }).filter((item) => item.word) : [];
  if (!words.length && typeof record.text === "string") words.push(...createLine(record.text, Math.round(lineStart), Math.max(Math.round(lineStart + 1), Math.round(lineEnd || lineStart + 4000))).words);
  if (!words.length && typeof record.content === "string") {
    const parsed = parseLyricText(record.content);
    return parsed[0] || null;
  }
  if (!words.length) return null;
  const startTime = Number.isFinite(lineStart) ? Math.round(lineStart) : words[0].startTime;
  const endTime = Math.max(startTime + 1, Number.isFinite(lineEnd) && lineEnd > lineStart ? Math.round(lineEnd) : words[words.length - 1].endTime);
  return { words, translatedLyric: String(record.translatedLyric ?? record.translation ?? ""), romanLyric: String(record.romanLyric ?? record.romanization ?? ""), isBG: !!record.isBG, isDuet: !!record.isDuet, startTime, endTime };
}

function normalizeParsed(lines: ParsedLyricLine[]): LyricLine[] {
  return lines.map((line) => ({
    words: (line.words || []).filter((word) => word.word.trim()).map((word) => ({ startTime: Math.round(word.startTime), endTime: Math.round(word.endTime), word: word.word, ...(word.romanWord ? { romanWord: word.romanWord } : {}) })),
    translatedLyric: line.translatedLyric || "",
    romanLyric: line.romanLyric || "",
    isBG: !!line.isBG,
    isDuet: !!line.isDuet,
    startTime: Math.round(line.startTime),
    endTime: Math.round(line.endTime),
  })).filter((line) => line.words.length > 0);
}

function mergeParallelLines(lines: LyricLine[]): LyricLine[] {
  const result: LyricLine[] = [];
  for (const line of lines) {
    const previous = result[result.length - 1];
    if (!previous || Math.abs(previous.startTime - line.startTime) > 8 || previous.isBG !== line.isBG || previous.isDuet !== line.isDuet) {
      result.push({ ...line, words: [...line.words] });
      continue;
    }
    const text = line.words.map((word) => word.word).join("").trim();
    if (!text) continue;
    if (containsCjk(text) && !containsCjk(previous.words.map((word) => word.word).join(""))) previous.translatedLyric = text;
    else if (looksRomanized(text) && !previous.romanLyric) previous.romanLyric = text;
    else if (!previous.translatedLyric) previous.translatedLyric = text;
  }
  return result;
}

function containsCjk(value: string) { return /[\u3400-\u9fff\u3040-\u30ff]/u.test(value); }
function looksRomanized(value: string) { const words = value.split(/\s+/).filter(Boolean); return words.length >= 2 && words.every((word) => word.length <= 4) && !containsCjk(value); }

export function mergeTranslation(main: LyricLine[], translation: LyricLine[]): LyricLine[] {
  return main.map((line) => {
    const candidate = translation.reduce<{ line: LyricLine | null; distance: number }>((best, item) => {
      const distance = Math.abs(item.startTime - line.startTime);
      return distance < best.distance ? { line: item, distance } : best;
    }, { line: null, distance: 120 }).line;
    return candidate ? { ...line, translatedLyric: candidate.words.map((word) => word.word).join("").trim() } : line;
  });
}

export function mergeRomanization(main: LyricLine[], romanization: LyricLine[]): LyricLine[] {
  return main.map((line) => {
    const candidate = romanization.reduce<{ line: LyricLine | null; distance: number }>((best, item) => {
      const distance = Math.abs(item.startTime - line.startTime);
      return distance < best.distance ? { line: item, distance } : best;
    }, { line: null, distance: 120 }).line;
    return candidate ? { ...line, romanLyric: candidate.words.map((word) => word.word).join("").trim() } : line;
  });
}

function makePlainTextLines(text: string): LyricLine[] {
  return text.split(/\r?\n/).map((line, index, all) => createLine(line, index * 4000, (index + 1 < all.length ? index + 1 : index + 1) * 4000)).filter((line) => line.words.length > 0);
}

function parseFeiniuTimestamped(text: string): LyricLine[] {
  const result: LyricLine[] = [];
  const singleTimestampRows: { text: string; startTime: number }[] = [];
  let detected = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const marks = [...line.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)];
    if (marks.length === 1) {
      if (marks[0].index === 0) continue;
      detected = true;
      const body = `${line.slice(0, marks[0].index)}${line.slice(marks[0].index! + marks[0][0].length)}`.trim();
      if (body) singleTimestampRows.push({ text: body, startTime: Math.round((Number(marks[0][1]) * 60 + Number(marks[0][2])) * 1000) });
      continue;
    }
    if (marks.length < 2) continue;
    detected = true;
    const times = marks.map((mark) => Math.round((Number(mark[1]) * 60 + Number(mark[2])) * 1000));
    const words: { startTime: number; endTime: number; word: string }[] = [];
    const prefix = line.slice(0, marks[0].index).trim();
    if (prefix) {
      words.push({ word: prefix, startTime: times[0], endTime: times[1] });
    }
    for (let index = prefix ? 1 : 0; index < marks.length - 1; index += 1) {
      const start = marks[index].index! + marks[index][0].length;
      const end = marks[index + 1].index!;
      const word = line.slice(start, end).trim();
      if (word) words.push({ word, startTime: times[index], endTime: times[index + 1] });
    }
    if (!words.length) {
      const body = line.slice(marks[marks.length - 1].index! + marks[marks.length - 1][0].length).trim();
      if (body) {
        for (let index = 0; index < times.length; index += 1) result.push(createLine(body, times[index], times[index + 1] || times[index] + 4000));
      }
      continue;
    }
    if (!words.length) continue;
    const startTime = Math.min(...words.map((word) => word.startTime));
    const endTime = Math.max(...words.map((word) => word.endTime));
    result.push({ words, translatedLyric: "", romanLyric: "", isBG: false, isDuet: false, startTime, endTime });
  }
  for (let index = 0; index < singleTimestampRows.length; index += 1) {
    const row = singleTimestampRows[index];
    const endTime = singleTimestampRows[index + 1]?.startTime || row.startTime + 4000;
    result.push(createLine(row.text, row.startTime, Math.max(row.startTime + 1, endTime)));
  }
  return detected ? mergeParallelLines(result.sort((a, b) => a.startTime - b.startTime)) : [];
}

function createLine(text: string, startTime: number, endTime: number): LyricLine {
  const chars = Array.from(text.trim());
  const duration = Math.max(1, endTime - startTime);
  return { words: chars.map((word, index) => ({ startTime: Math.round(startTime + duration * index / chars.length), endTime: Math.round(startTime + duration * (index + 1) / chars.length), word })), translatedLyric: "", romanLyric: "", isBG: false, isDuet: false, startTime, endTime };
}

function parseKrc(plain: string): LyricLine[] {
  const result: LyricLine[] = [];
  for (const raw of plain.split(/\r?\n/)) {
    const line = raw.trim();
    const tokens = [...line.matchAll(/\[(\d+),(\d+)\]/g)];
    if (!tokens.length) continue;
    const body = line.slice(tokens[tokens.length - 1].index! + tokens[tokens.length - 1][0].length);
    const words = [...body.matchAll(/<(\d+),(\d+),\d+>([\s\S]*?)(?=<|$)/g)];
    for (const token of tokens) {
      const startTime = Number(token[1]);
      const endTime = startTime + Number(token[2]);
      const parsedWords = words.length ? words.map((word) => ({ startTime: startTime + Number(word[1]), endTime: startTime + Number(word[1]) + Number(word[2]), word: word[3] })) : Array.from(body).map((word, index, chars) => ({ startTime: Math.round(startTime + (endTime - startTime) * index / chars.length), endTime: Math.round(startTime + (endTime - startTime) * (index + 1) / chars.length), word }));
      result.push({ words: parsedWords, translatedLyric: "", romanLyric: "", isBG: false, isDuet: false, startTime, endTime });
    }
  }
  const language = parseKrcLanguage(plain);
  return result.map((line, index) => {
    const romanWords = language.romanWords[index];
    const words = romanWords?.length === line.words.length
      ? line.words.map((word, wordIndex) => ({ ...word, romanWord: romanWords[wordIndex] }))
      : line.words;
    return { ...line, words, translatedLyric: language.translation[index] || "", romanLyric: language.roman[index] || "" };
  });
}

function parseKrcLanguage(plain: string) {
  const empty = { translation: [] as string[], roman: [] as string[], romanWords: [] as string[][] };
  const match = plain.match(/\[language:([^\]]+)\]/i);
  if (!match) return empty;
  try {
    const encoded = match[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(match[1].length / 4) * 4, "=");
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))));
    const content = Array.isArray(decoded?.content) ? decoded.content : [];
    for (const item of content) {
      const rows = Array.isArray(item?.lyricContent) ? item.lyricContent : [];
      const values = rows.map((row: unknown) => Array.isArray(row) ? row.map((word) => String(word || "")).join("").trim() : String(row || "").trim());
      if (Number(item?.type) === 1) empty.translation = values;
      if (Number(item?.type) === 0) {
        empty.roman = values;
        empty.romanWords = rows.map((row: unknown) => Array.isArray(row) ? row.map((word) => String(word || "")).filter(Boolean) : []);
      }
    }
  } catch {}
  return empty;
}

function decodeKrc(value: string) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (bytes.length < 4) return "";
  for (let index = 4; index < bytes.length; index += 1) bytes[index] ^= krcKey[(index - 4) % krcKey.length];
  try { return new TextDecoder().decode(inflate(bytes.slice(4))); } catch { return new TextDecoder().decode(bytes.slice(4)); }
}

export function hasTimedLyric(value: string) { return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(value) || /<(?:tt|p|span)\b/i.test(value) || /\[\d+,\d+\]/.test(value) || /<\d+,\d+,\d+>/.test(value); }
function isLyricText(value: string) { return hasTimedLyric(value) || /\r?\n/.test(value) && value.trim().length > 12 || /<(?:tt|p|span|\d+,\d+)/i.test(value) || value.trim().length > 12; }

function cleanLyricSource(value: string) {
  return value.split(/\r?\n/).filter((raw) => {
    const line = raw.trim();
    if (!line) return false;
    if (/^\[(?:ti|ar|al|by|offset|language|kana|id|hash|sign|reclrc|tool):[^\]]*\]$/i.test(line)) return false;
    if (!hasTimedLyric(line) && /^(?:作词|作曲|编曲|制作|监制|出品|lyrics?|composer|producer|written\s+by)\s*[:：]/i.test(line)) return false;
    return true;
  }).join("\n").trim();
}

export function extractLyricText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(extractLyricText).find(Boolean) || "";
  const record = value as RawRecord;
  const data = record.data && typeof record.data === "object" ? record.data as RawRecord : record;
  const list = Array.isArray(data.list) ? data.list : [];
  const preferred = typeof data.preferred === "string" ? data.preferred : "";
  const item = list.find((entry) => entry && typeof entry === "object" && (entry as RawRecord).guid === preferred) || list.find((entry) => entry && typeof entry === "object" && typeof (entry as RawRecord).content === "string");
  if (item && typeof item === "object" && typeof (item as RawRecord).content === "string") return (item as RawRecord).content as string;
  for (const key of ["content", "ttml", "qrc", "yrc", "krc", "lrc", "lyrics", "lyric", "text", "rawLyric"]) {
    const text = extractLyricText(record[key]);
    if (text) return text;
  }
  return "";
}
