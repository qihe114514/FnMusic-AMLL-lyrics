export type SourceId = "amll" | "kugou" | "netease" | "feiniu" | "none";

export type SongQuery = {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  guid?: string;
};

export type Candidate = {
  sourceId: SourceId;
  id: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  raw?: unknown;
};

export type MatchInput = {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
};

export type MatchCandidate = {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
};

export type MatchResult = {
  qualified: boolean;
  titleScore: number;
  artistScore: number;
  durationScore: number;
  albumBonus: number;
  combined: number;
  titlePass: boolean;
  artistPass: boolean;
  durationPass: boolean;
  versionPass: boolean;
  reason: string;
};

export type AmllQueryVariant = {
  musicName: string;
  artistName?: string;
};
