import { describe, expect, it } from "vitest";
import { formatAmount } from "~~/utils/lambdaplex/format";

describe("formatAmount", () => {
  it("trims exchange padding and groups thousands", () => {
    expect(formatAmount("0.100407000000")).toBe("0.100407");
    expect(formatAmount("398.378609060000000000", 2)).toBe("398.37");
    expect(formatAmount("1234567.5")).toBe("1,234,567.5");
    expect(formatAmount(5)).toBe("5");
  });

  it("expands exponent notation instead of printing it", () => {
    expect(formatAmount("1e-7", 8)).toBe("0.0000001");
    expect(formatAmount(2.5e-5, 8)).toBe("0.000025");
  });
});
