// Valence colours between the seven token steps are interpolated in CIELAB
// (docs/design-system.md §2.2): symmetrised-mean valence can fall half-way
// between two scale points. Conversions use sRGB with the D65 white point.

type Lab = [number, number, number];

const WHITE = [0.95047, 1, 1.08883] as const;

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function fromLinear(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function hexToLab(hex: string): Lab {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a six-digit hex colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) =>
    toLinear(Number.parseInt(x ?? '0', 16) / 255),
  ) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0];
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1];
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function labToHex([l, a, b]: Lab): string {
  const fy = (l + 16) / 116;
  const x = fInv(fy + a / 500) * WHITE[0];
  const y = fInv(fy) * WHITE[1];
  const z = fInv(fy - b / 200) * WHITE[2];
  const rgb = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
  return (
    '#' +
    rgb
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/**
 * Colour for a valence value on the −3…+3 palette scale. Whole steps return
 * the token colour itself; values between steps are interpolated in CIELAB.
 */
export function valenceColour(scale: readonly string[], value: number): string {
  const steps = scale.length - 1;
  const half = steps / 2;
  const t = Math.min(steps, Math.max(0, value + half));
  const lo = Math.floor(t);
  const frac = t - lo;
  const a = scale[lo] as string;
  if (frac < 1e-9) return a;
  const b = scale[lo + 1] as string;
  const la = hexToLab(a);
  const lb = hexToLab(b);
  return labToHex([
    la[0] + (lb[0] - la[0]) * frac,
    la[1] + (lb[1] - la[1]) * frac,
    la[2] + (lb[2] - la[2]) * frac,
  ]);
}
