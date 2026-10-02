import { describe, expect, it } from "vitest";
import { formatAmount } from "~~/utils/lambdaplex/format";

describe("formatAmount", () => {
  it("trims exchange padding and groups thousands", () => {
    expect(formatAmount("0.100407000000")).toBe("0.100407");
    expect(formatAmount("398.378609060000000000", 2)).toBe("398.37");
    expect(formatAmount("1234567.5")).toBe("1,234,567.5");
    expect(formatAmount(5)).toBe("5");
  });
});
