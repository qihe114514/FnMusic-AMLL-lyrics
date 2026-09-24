import type { MatchCandidate, MatchInput, MatchResult } from "./types.ts";
import { canonicalArtist, compact, similarity, splitArtists, versionPass } from "./normalize.ts";

export const MATCH_THRESHOLDS = {
  title: 0.75,
  combined: 0.75,
  durationToleranceMs: 5_000,
  artistDiffTolerance: 2,
} as const;

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

function artistTokens(input: MatchInput, candidate: MatchCandidate) {
  const inputArtists = (input.artists?.length ? input.artists : splitArtists(input.artist)).map(canonicalArtist).filter(Boolean);
  const candidateArtists = (candidate.artists?.length ? candidate.artists : splitArtists(candidate.artist)).map(canonicalArtist).filter(Boolean);
  return { inputArtists, candidateArtists };
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

export function evaluateMatch(input: MatchInput, candidate: MatchCandidate): MatchResult {
  const titleScore = similarity(input.title, candidate.title);
  const durationDiff = durationDifference(input.durationMs, candidate.durationMs);
  const durationPass = durationDiff === null || durationDiff <= MATCH_THRESHOLDS.durationToleranceMs;
  const durationScore = durationDiff === null ? 0.5 : durationPass ? 1 - (durationDiff / MATCH_THRESHOLDS.durationToleranceMs) * 0.35 : 0;
  const { inputArtists, candidateArtists } = artistTokens(input, candidate);
  const artist = artistMatch(inputArtists, candidateArtists);
  const albumScore = input.album && candidate.album ? similarity(input.album, candidate.album) : 0;
  const albumBonus = albumScore >= 0.8 ? 0.03 : 0;
  const versionPassResult = versionPass(input.title, candidate.title);

  const dimensions: Array<[number, number]> = [[titleScore, 0.62]];
  if (inputArtists.length && candidateArtists.length) dimensions.push([artist.score, 0.28]);
  if (durationDiff !== null) dimensions.push([durationScore, 0.10]);
  const weightTotal = dimensions.reduce((total, [, weight]) => total + weight, 0);
  const baseCombined = weightTotal > 0 ? dimensions.reduce((total, [value, weight]) => total + value * weight, 0) / weightTotal : 0;
  const combined = Math.min(1, baseCombined + albumBonus);

  const titlePass = titleScore >= MATCH_THRESHOLDS.title;
  const artistPass = artist.pass;
  const qualified = titlePass && durationPass && artistPass && versionPassResult && combined >= MATCH_THRESHOLDS.combined;
  const reason = qualified
    ? "匹配通过"
    : [
        !versionPassResult ? "标题版本不一致（伴奏/纯音乐/现场/混音/翻唱等）" : "",
        !titlePass ? `标题相似度 ${(titleScore * 100).toFixed(1)}% 低于 ${MATCH_THRESHOLDS.title * 100}%` : "",
        !durationPass ? `时长差 ${Math.round((durationDiff || 0) / 1000)}s 超过 ${MATCH_THRESHOLDS.durationToleranceMs / 1000}s` : "",
        !artistPass ? "歌手数量或名称差异过大" : "",
        combined < MATCH_THRESHOLDS.combined ? `综合相似度 ${(combined * 100).toFixed(1)}% 低于 ${MATCH_THRESHOLDS.combined * 100}%` : "",
      ].filter(Boolean).join("；") || "匹配度过低";

  return {
    qualified,
    titleScore,
    artistScore: artist.score,
    durationScore,
    albumBonus,
    combined,
    titlePass,
    artistPass,
    durationPass,
    versionPass: versionPassResult,
    reason,
  };
}

export { compact, splitArtists, normalizeSongKey } from "./normalize.ts";
