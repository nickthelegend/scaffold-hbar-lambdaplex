import { friendlyTxError } from "./txErrors";
import { describe, expect, it } from "vitest";

describe("friendlyTxError", () => {
  it("explains registry reverts", () => {
    expect(friendlyTxError('"register" reverted with the following reason:\nInvalidTopic()')).toMatch(/HCS topic id/);
    expect(friendlyTxError("reverted with the following reason: NotOperator(3)")).toBe(
      "Only the operator of strategy #3 can change it.",
    );
  });

  it("recognises a rejected signature and leaves unknown errors alone", () => {
    expect(friendlyTxError("User rejected the request.")).toBe("You cancelled the transaction in your wallet.");
    expect(friendlyTxError("Nonce too low")).toBe("Nonce too low");
  });
});
