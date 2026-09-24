import type { MatchInput } from "./types.ts";

const VERSION_WORDS = /(?:feat(?:uring)?\.?|ft\.?|with|remaster(?:ed)?|live|version|ver\.?|radio\s*edit|original\s*mix|acoustic|cover|翻唱|纯音乐)/gi;
const PUNCTUATION = /[^\p{L}\p{N}]+/gu;
const ARTIST_SPLIT = /[\s,，、/&＆;；+·・|]+|(?:feat(?:uring)?|ft\.?|with)\s*/gi;
const INSTRUMENTAL = /伴奏|纯音乐|instrumental|off\s*vocal|karaoke/i;

const SIMPLIFIED_MAP: Record<string, string> = {
  臺: "台", 灣: "湾", 體: "体", 這: "这", 裡: "里", 為: "为", 與: "与", 從: "从",
  麼: "么", 會: "会", 個: "个", 來: "来", 時: "时", 愛: "爱", 聽: "听", 說: "说",
  後: "后", 見: "见", 現: "现", 開: "开", 關: "关", 長: "长", 門: "门", 問: "问",
  無: "无", 聲: "声", 風: "风", 雲: "云", 電: "电", 車: "车", 東: "东", 馬: "马",
  鳥: "鸟", 魚: "鱼", 龍: "龙", 貓: "猫", 貝: "贝", 頁: "页", 話: "话", 誰: "谁",
  應: "应", 該: "该", 還: "还", 過: "过", 對: "对", 錯: "错", 讓: "让",
};

export const ARTIST_ALIASES: Record<string, string> = {
  jaychou: "周杰伦",
  周杰伦: "周杰伦",
  easonchan: "陈奕迅",
  陈奕迅: "陈奕迅",
  jjlin: "林俊杰",
  林俊杰: "林俊杰",
  taylorswift: "taylor swift",
  "taylor swift": "taylor swift",
  edsheeran: "ed sheeran",
  "ed sheeran": "ed sheeran",
  hoyomix: "hoyomix",
  "hoyo-mix": "hoyomix",
  知更鸟: "知更鸟",
  知更鳥: "知更鸟",
  robin: "robin",
  chevy: "chevy",
};

export function toSimplified(value: string) {
  return Array.from(value).map((char) => SIMPLIFIED_MAP[char] || char).join("");
}

export function compact(value: string | undefined | null) {
  if (!value) return "";
  return toSimplified(String(value))
    .toLowerCase()
    .replace(VERSION_WORDS, "")
    .replace(PUNCTUATION, "")
    .trim();
}

export function splitArtists(value?: string | null) {
  if (!value) return [] as string[];
  return String(value)
    .replace(ARTIST_SPLIT, "\n")
    .split(/\n+/)
    .map((item) => canonicalArtist(item))
    .filter(Boolean);
}

export function canonicalArtist(value: string) {
  const compactValue = compact(value);
  return ARTIST_ALIASES[compactValue] || compactValue;
}

export function isInstrumentalMark(value?: string | null) {
  return INSTRUMENTAL.test(String(value || ""));
}

export function versionTags(value?: string | null) {
  const text = String(value || "").toLowerCase();
  return {
    instrumental: isInstrumentalMark(text),
    live: /live|现场/.test(text),
    remix: /remix|混音/.test(text),
    cover: /cover|翻唱/.test(text),
    acoustic: /acoustic|unplugged|acoustic version/.test(text),
    radio: /radio\s*edit|radio edit/.test(text),
  };
}

export function versionPass(inputTitle?: string | null, candidateTitle?: string | null) {
  const input = versionTags(inputTitle);
  const candidate = versionTags(candidateTitle);
  const keys = Object.keys(input) as Array<keyof typeof input>;
  for (const key of keys) {
    if (input[key] !== candidate[key]) return false;
  }
  return true;
}

export function similarity(left: string, right: string) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const rows = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = rows[0];
    rows[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = rows[j];
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return Math.max(0, 1 - rows[b.length] / Math.max(a.length, b.length));
}

export function normalizeSongKey(input: MatchInput, candidateDurationMs?: number) {
  const duration = Math.round(Number(candidateDurationMs ?? input.durationMs ?? 0) / 1000);
  const artists = (input.artists?.length ? input.artists : splitArtists(input.artist)).map(canonicalArtist).sort().join(",");
  return [compact(input.title), artists, duration].join("|");
}

