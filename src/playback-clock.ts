export type PlaybackAnchor = {
  currentTimeMs: number;
  observedAt: number;
  playing: boolean;
};

type PlaybackFallback = {
  currentTimeMs: number;
  playing: boolean;
};

type PlaybackClockInput = {
  now: number;
  bridge: PlaybackAnchor | null;
  fallback: PlaybackFallback;
};

const bridgeTimeoutMs = 1_000;

export function resolvePlaybackClock({ now, bridge, fallback }: PlaybackClockInput): PlaybackFallback {
  if (!bridge || now - bridge.observedAt > bridgeTimeoutMs) return fallback;
  return {
    currentTimeMs: Math.max(0, Math.round(bridge.currentTimeMs + (bridge.playing ? now - bridge.observedAt : 0))),
    playing: bridge.playing,
  };
}
