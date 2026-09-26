// Reads a motion token (`--m-*`) in milliseconds. The production build's CSS
// minifier rewrites durations (600ms becomes .6s), so the unit is parsed
// rather than assumed. Returns 0 when the token is missing or unreadable.

export function parseDuration(text: string): number {
  const m = /^\s*(-?[\d.]+)\s*(ms|s)?\s*$/i.exec(text);
  if (!m) return 0;
  const v = Number.parseFloat(m[1] ?? '');
  if (!Number.isFinite(v)) return 0;
  return (m[2] ?? 'ms').toLowerCase() === 's' ? v * 1000 : v;
}

export function durationToken(name: string, element?: Element): number {
  if (typeof document === 'undefined') return 0;
  return parseDuration(
    getComputedStyle(element ?? document.documentElement).getPropertyValue(name),
  );
}
