export type AmllScrollState = {
  scrollBoundary?: { minOffset?: number; maxOffset?: number };
  scrollOffset: number;
  isScrolled?: boolean;
  isUserScrolling?: boolean;
};

export type AmllPlayerLike = {
  beginScrollHandler?: () => boolean;
  setCurrentTime?: (time: number, isSeek?: boolean) => void;
  resetScroll?: () => void;
  calcLayout?: (sync?: boolean, force?: boolean) => void | Promise<void>;
  scrollState?: AmllScrollState;
};

export function clampScrollOffset(offset: number, min: number, max: number) {
  if (!Number.isFinite(offset)) return min;
  if (min > max) return min;
  return Math.max(min, Math.min(max, offset));
}

const AUTO_RESUME_MS = 5_000;
const PIXEL_DELTA_MODE = typeof WheelEvent !== "undefined" ? WheelEvent.DOM_DELTA_PIXEL : 0;

export function bindWheelScroll(getRoot: () => HTMLElement | null, getPlayer: () => AmllPlayerLike | null | undefined) {
  let resumeTimer = 0;

  const onWheel = (event: WheelEvent) => {
    const root = getRoot();
    const player = getPlayer();
    if (!root || !player || !(event.target instanceof Node) || !root.contains(event.target)) return;
    const scrollState = player.scrollState;
    if (!scrollState || typeof player.beginScrollHandler !== "function" || typeof player.calcLayout !== "function") return;
    if (!player.beginScrollHandler()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const min = Number(scrollState.scrollBoundary?.minOffset ?? 0);
    const max = Number(scrollState.scrollBoundary?.maxOffset ?? 0);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;

    const delta = event.deltaMode === PIXEL_DELTA_MODE ? event.deltaY : event.deltaY * 50;
    scrollState.scrollOffset = clampScrollOffset(scrollState.scrollOffset + delta, min, max);
    scrollState.isScrolled = true;
    void player.calcLayout(true, event.deltaMode !== PIXEL_DELTA_MODE);

    if (resumeTimer) window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      resumeTimer = 0;
      player.resetScroll?.();
      void player.calcLayout?.(true, true);
    }, AUTO_RESUME_MS);
  };

  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    window.removeEventListener("wheel", onWheel, { capture: true });
    if (resumeTimer) window.clearTimeout(resumeTimer);
  };
}
