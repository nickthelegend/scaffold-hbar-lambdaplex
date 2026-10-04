import { type TwapConfig, validateTwapConfig } from "@sh/lambdaplex";

/**
 * Limits for TWAPs started from the web app, tighter than the SDK's (which also serves the CLI): a hosted job runs
 * in the server process, so it is kept short and coarse-grained.
 */
export const WEB_TWAP_LIMITS = {
  slices: { min: 1, max: 50 },
  intervalSeconds: { min: 5, max: 3600 },
  maxSlippageBps: { min: 0, max: 500 },
} as const;

/** The form's labels for the field names `validateTwapConfig` reports. */
const FIELD_LABELS: Record<string, string> = {
  symbol: "Market",
  side: "Side",
  total: "Total",
  slices: "Slices",
  intervalSeconds: "Interval",
  maxSlippageBps: "Max slippage",
};

const between = (value: number, { min, max }: { min: number; max: number }) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Everything wrong with a web TWAP config, as sentences for the form; the API route returns the same list. */
export function webTwapProblems(config: TwapConfig): string[] {
  const { slices, intervalSeconds, maxSlippageBps } = WEB_TWAP_LIMITS;
  const sdk = validateTwapConfig(config).map(p => {
    const [field, ...rest] = p.split(" ");
    return `${FIELD_LABELS[field] ?? field} ${rest.join(" ")}.`;
  });
  const web = [
    !between(config.slices, slices) && `Slices must be a whole number from ${slices.min} to ${slices.max}.`,
    !between(config.intervalSeconds, intervalSeconds) &&
      `Interval must be a whole number of seconds from ${intervalSeconds.min} to ${intervalSeconds.max}.`,
    !between(config.maxSlippageBps, maxSlippageBps) &&
      `Max slippage must be a whole number of bps from ${maxSlippageBps.min} to ${maxSlippageBps.max}.`,
  ].filter((p): p is string => Boolean(p));
  // The web limits are the stricter wording for the same three fields; keep the SDK's other findings.
  return [...sdk.filter(p => !/^(Slices|Interval|Max slippage) /.test(p)), ...web];
}
