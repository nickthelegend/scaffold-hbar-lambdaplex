/** StrategyRegistry custom errors, in words an operator can act on. `arg` is the error's first argument. */
const REGISTRY_ERRORS: Record<string, (arg: string) => string> = {
  InvalidName: () => "The strategy name must be 1 to 64 bytes long.",
  InvalidTopic: () => "Enter the HCS topic id (0.0.x) of the strategy's track record.",
  InvalidVenueAccount: () => "The Lambdaplex account must be at most 64 bytes.",
  InvalidOperator: () => "Transfer the strategy to a real address, not the zero address.",
  InvalidRunningHash: () => "A checkpoint needs the topic's 48-byte running hash.",
  NotOperator: arg => `Only the operator of strategy #${arg} can change it.`,
  UnknownStrategy: arg => `There is no strategy #${arg}.`,
  StaleCheckpoint: arg => `Checkpoints only move forward: the latest one is already at sequence ${arg}.`,
};

/**
 * Turns a parsed transaction error (e.g. `"register" reverted with the following reason: InvalidTopic()`) into a
 * sentence, or returns it unchanged when it isn't one of ours.
 */
export const friendlyTxError = (message: string): string => {
  if (/user (rejected|denied)|rejected the request/i.test(message))
    return "You cancelled the transaction in your wallet.";
  const match = /\b([A-Z][A-Za-z]+)\((\d*)/.exec(message);
  const describe = match && REGISTRY_ERRORS[match[1]];
  return describe ? describe(match[2]) : message;
};
