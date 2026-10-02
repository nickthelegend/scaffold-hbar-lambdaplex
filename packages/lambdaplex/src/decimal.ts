/**
 * Exact decimal arithmetic on strings, as the exchange expects them ("0.100407000000"). Prices and quantities never
 * pass through floating point, so rounding to tick and step sizes is exact.
 */
const SCALE = 18;
const ONE = 10n ** BigInt(SCALE);

export function toUnits(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(SCALE) : value.trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) throw new Error(`Not a decimal: "${value}"`);
  const [, sign, whole, fraction = ""] = match;
  const units = BigInt(whole || "0") * ONE + BigInt((fraction + "0".repeat(SCALE)).slice(0, SCALE) || "0");
  return sign ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / ONE;
  const fraction = (abs % ONE).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Largest multiple of `step` that is ≤ value. */
export function floorTo(value: string, step: string): string {
  const v = toUnits(value);
  const s = toUnits(step);
  if (s <= 0n) return fromUnits(v);
  return fromUnits((v / s) * s);
}

/** Smallest multiple of `step` that is ≥ value. */
export function ceilTo(value: string, step: string): string {
  const v = toUnits(value);
  const s = toUnits(step);
  if (s <= 0n) return fromUnits(v);
  return fromUnits(((v + s - 1n) / s) * s);
}

export function mul(a: string, b: string): string {
  return fromUnits((toUnits(a) * toUnits(b)) / ONE);
}

export function div(a: string, b: string): string {
  const divisor = toUnits(b);
  if (divisor === 0n) throw new Error("Division by zero");
  return fromUnits((toUnits(a) * ONE) / divisor);
}

export function add(a: string, b: string): string {
  return fromUnits(toUnits(a) + toUnits(b));
}

export function sub(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

export function cmp(a: string, b: string): -1 | 0 | 1 {
  const d = toUnits(a) - toUnits(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/** `value × (10_000 ± bps) / 10_000` */
export function applyBps(value: string, bps: number): string {
  return fromUnits((toUnits(value) * BigInt(10_000 + bps)) / 10_000n);
}
