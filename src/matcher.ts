export const MATCH_THRESHOLDS = {
  title: 0.75,
  combined: 0.75,
  durationToleranceMs: 5_000,
  artistDiffTolerance: 2,
} as const;

export type MatchInput = {
  title: string;
  artist?: string;
  durationMs?: number;
};

export type MatchCandidate = {
  title: string;
  artist?: string;
  durationMs?: number;
};

export type MatchResult = {
  qualified: boolean;
  titleScore: number;
  artistScore: number;
  durationScore: number;
  combined: number;
  titlePass: boolean;
  artistPass: boolean;
  durationPass: boolean;
  reason: string;
};

const VERSION_WORDS = /(?:feat(?:uring)?\.?|ft\.?|with|remaster(?:ed)?|live|version|ver\.?|radio\s*edit|original\s*mix|acoustic|伴奏|纯音乐|翻唱|cover)/gi;
const PUNCTUATION = /[^\p{L}\p{N}]+/gu;
const ARTIST_SPLIT = /[\s,，、/&＆;；+·・|]+|(?:feat(?:uring)?|ft\.?|with)\s*/gi;

const ARTIST_ALIASES: Record<string, string> = {
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
};

export function compact(value: string | undefined | null) {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .replace(VERSION_WORDS, "")
    .replace(PUNCTUATION, "")
    .trim();
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

function canonicalArtistToken(value: string) {
  const compactValue = compact(value);
  return ARTIST_ALIASES[compactValue] || compactValue;
}

export function splitArtists(value: string | undefined | null) {
  if (!value) return [] as string[];
  return String(value)
    .replace(ARTIST_SPLIT, "\n")
    .split(/\n+/)
    .map((item) => canonicalArtistToken(item))
    .filter(Boolean);
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left))) return 0.85;
  return similarity(left, right);
}

function bestSimilarity(token: string, candidates: string[]) {
  let best = 0;
  for (const candidate of candidates) best = Math.max(best, tokenSimilarity(token, candidate));
  return best;
}

function artistMatch(inputArtists: string[], candidateArtists: string[]) {
  if (!inputArtists.length || !candidateArtists.length) return { score: 0.5, pass: true };
  const diff = Math.abs(inputArtists.length - candidateArtists.length);
  const requestedScore = inputArtists.reduce((total, token) => total + bestSimilarity(token, candidateArtists), 0) / inputArtists.length;
  const candidateScore = candidateArtists.reduce((total, token) => total + bestSimilarity(token, inputArtists), 0) / candidateArtists.length;
  const rawScore = (requestedScore + candidateScore) / 2;
  const score = diff > MATCH_THRESHOLDS.artistDiffTolerance ? 0 : rawScore * (1 - Math.min(diff, MATCH_THRESHOLDS.artistDiffTolerance) * 0.08);
  const pass = diff <= MATCH_THRESHOLDS.artistDiffTolerance && score >= 0.45;
  return { score, pass };
}

export function durationDifference(requestedDurationMs?: number, candidateDurationMs?: number) {
  if (!Number.isFinite(Number(requestedDurationMs)) || !Number.isFinite(Number(candidateDurationMs))) return null;
  const requested = Number(requestedDurationMs);
  const candidate = Number(candidateDurationMs);
  if (requested <= 0 || candidate <= 0) return null;
  return Math.abs(requested - candidate);
}

function isInstrumentalMark(value?: string | null) {
  return /伴奏|纯音乐|instrumental|offs*vocal|karaoke/i.test(String(value || ""));
}

export function evaluateMatch(input: MatchInput, candidate: MatchCandidate): MatchResult {
  const titleScore = similarity(input.title, candidate.title);
  const durationDiff = durationDifference(input.durationMs, candidate.durationMs);
  const durationPass = durationDiff === null || durationDiff <= MATCH_THRESHOLDS.durationToleranceMs;
  const durationScore = durationDiff === null ? 0.5 : durationPass ? 1 - (durationDiff / MATCH_THRESHOLDS.durationToleranceMs) * 0.35 : 0;

  const inputArtists = splitArtists(input.artist);
  const candidateArtists = splitArtists(candidate.artist);
  const artist = artistMatch(inputArtists, candidateArtists);

  const dimensions: Array<[number, number]> = [[titleScore, 0.65]];
  if (inputArtists.length && candidateArtists.length) dimensions.push([artist.score, 0.25]);
  if (durationDiff !== null) dimensions.push([durationScore, 0.1]);
  const weightTotal = dimensions.reduce((total, [, weight]) => total + weight, 0);
  const combined = weightTotal > 0 ? dimensions.reduce((total, [value, weight]) => total + value * weight, 0) / weightTotal : 0;

  const versionMismatch = isInstrumentalMark(input.title) !== isInstrumentalMark(candidate.title);
  const titlePass = titleScore >= MATCH_THRESHOLDS.title && !versionMismatch;
  const artistPass = artist.pass;
  const qualified = titlePass && durationPass && artistPass && combined >= MATCH_THRESHOLDS.combined;
  const reason = qualified
    ? "匹配通过"
    : [
        versionMismatch ? "标题版本不一致（伴奏/纯音乐与原曲）" : "",
        !titlePass && !versionMismatch ? `标题相似度 ${(titleScore * 100).toFixed(1)}% 低于 ${MATCH_THRESHOLDS.title * 100}%` : "",
        !durationPass ? `时长差 ${Math.round((durationDiff || 0) / 1000)}s 超过 ${MATCH_THRESHOLDS.durationToleranceMs / 1000}s` : "",
        !artistPass ? "歌手数量或名称差异过大" : "",
        combined < MATCH_THRESHOLDS.combined ? `综合相似度 ${(combined * 100).toFixed(1)}% 低于 ${MATCH_THRESHOLDS.combined * 100}%` : "",
      ].filter(Boolean).join("；") || "匹配度过低";

  return { qualified, titleScore, artistScore: artist.score, durationScore, combined, titlePass, artistPass, durationPass, reason };
}

export function normalizeSongKey(input: MatchInput, candidateDurationMs?: number) {
  const duration = Math.round(Number(candidateDurationMs ?? input.durationMs ?? 0) / 1000);
  return [compact(input.title), compact(input.artist), duration].join("|");
}
