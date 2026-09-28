// Colour arithmetic for the Phase 8 contrast and colour-vision checks
// (tests/unit/contrast.test.ts, scripts/cvd-simulate.mjs uses the same
// matrices). WCAG 2.x relative luminance and contrast; CSS Color 4 `lab`
// (CIELAB, D50, Bradford-adapted from sRGB's D65) for color-mix(in lab, …);
// CIEDE2000 on D65 CIELAB, as design-system.md used; Machado, Oliveira &
// Fernandes (2009) dichromacy matrices at severity 1.0, applied in linear sRGB.

export type Rgb = [number, number, number];

export function hex(value: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m?.[1]) throw new Error(`Not a hex colour: ${value}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => {
  const c = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `a` drawn at opacity `alpha` over `b`, blended in sRGB as a canvas does. */
export function over(a: Rgb, alpha: number, b: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round((a[i] ?? 0) * alpha + (b[i] ?? 0) * (1 - alpha))) as Rgb;
}

// ------------------------------------------------------------------ CIELAB
type Vec = [number, number, number];
const mul = (m: number[][], v: Vec): Vec =>
  m.map((r) => (r[0] ?? 0) * v[0] + (r[1] ?? 0) * v[1] + (r[2] ?? 0) * v[2]) as Vec;

const SRGB_TO_XYZ65 = [
  [0.4123907992659595, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151036, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462599, 0.9505321522496606],
];
const XYZ65_TO_SRGB = [
  [3.2409699419045213, -1.5373831775700935, -0.4986107602930033],
  [-0.9692436362808798, 1.8759675015077206, 0.04155505740717561],
  [0.05563007969699361, -0.20397695888897657, 1.0569715142428786],
];
const D65_TO_D50 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const D50_TO_D65 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const WHITE_D50: Vec = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const WHITE_D65: Vec = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];

const E = 216 / 24389;
const K = 24389 / 27;

function xyzToLab(xyz: Vec, white: Vec): Vec {
  const f = xyz.map((v, i) => {
    const t = v / (white[i] ?? 1);
    return t > E ? Math.cbrt(t) : (K * t + 16) / 116;
  }) as Vec;
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

function labToXyz([l, a, b]: Vec, white: Vec): Vec {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number) => (f ** 3 > E ? f ** 3 : (116 * f - 16) / K);
  return [inv(fx) * white[0], (l > K * E ? fy ** 3 : l / K) * white[1], inv(fz) * white[2]];
}

const linear = (c: Rgb): Vec => [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];

/** CSS `lab()` (D50). */
export function lab50(c: Rgb): Vec {
  return xyzToLab(mul(D65_TO_D50, mul(SRGB_TO_XYZ65, linear(c))), WHITE_D50);
}

export function fromLab50(l: Vec): Rgb {
  const rgbLinear = mul(XYZ65_TO_SRGB, mul(D50_TO_D65, labToXyz(l, WHITE_D50)));
  return rgbLinear.map(fromLinear) as Rgb;
}

/** color-mix(in lab, a p, b): `p` of a, the rest of b. */
export function mixLab(a: Rgb, p: number, b: Rgb): Rgb {
  const la = lab50(a);
  const lb = lab50(b);
  return fromLab50([0, 1, 2].map((i) => (la[i] ?? 0) * p + (lb[i] ?? 0) * (1 - p)) as Vec);
}

/** CIELAB under D65, for ΔE00 (design-system.md's convention). */
export function lab65(c: Rgb): Vec {
  return xyzToLab(mul(SRGB_TO_XYZ65, linear(c)), WHITE_D65);
}

/** CIEDE2000 colour difference. */
export function deltaE00(c1: Rgb, c2: Rgb): number {
  const [L1, a1, b1] = lab65(c1);
  const [L2, a2, b2] = lab65(c2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const d = Math.atan2(b, a) / rad;
    return d < 0 ? d + 360 : d;
  };
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hpm = h1p + h2p < 360 ? (hpm + 360) / 2 : (hpm - 360) / 2;
    else hpm /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * rad) +
    0.24 * Math.cos(2 * hpm * rad) +
    0.32 * Math.cos((3 * hpm + 6) * rad) -
    0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

// ------------------------------------------------ colour-vision simulation
/** Machado, Oliveira & Fernandes (2009), severity 1.0, for linear sRGB. */
export const CVD: Record<'protanopia' | 'deuteranopia' | 'tritanopia', number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(c: Rgb, condition: keyof typeof CVD): Rgb {
  return mul(CVD[condition], linear(c)).map(fromLinear) as Rgb;
}
