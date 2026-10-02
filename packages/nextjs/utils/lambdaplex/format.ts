/** Trims exchange decimals ("0.100407000000" → "0.100407") and groups thousands. */
export function formatAmount(value: string | number, maxFractionDigits = 6) {
  const [whole, fraction = ""] = String(value).split(".");
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export const formatDateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
