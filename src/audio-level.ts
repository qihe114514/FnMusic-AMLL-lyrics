export function clampUnit(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function lowFrequencyVolume(
  data: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  fromHz = 80,
  toHz = 120,
) {
  if (!data.length || !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(fftSize) || fftSize <= 0) return 1;
  const binWidth = sampleRate / fftSize;
  const start = Math.max(0, Math.floor(fromHz / binWidth));
  const end = Math.min(data.length, Math.max(start + 1, Math.ceil(toHz / binWidth) + 1));
  if (end <= start) return 1;
  let total = 0;
  for (let index = start; index < end; index += 1) total += Number(data[index]) || 0;
  return clampUnit(Math.sqrt((total / (end - start)) / 255));
}
