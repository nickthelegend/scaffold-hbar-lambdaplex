import { describe, expect, it } from "vitest";
import {
  add,
  applyBps,
  ceilTo,
  cmp,
  div,
  floorTo,
  fromUnits,
  mul,
  sub,
  toDecimalString,
  toUnits,
} from "../../src/decimal";

describe("decimal", () => {
  it("round-trips exchange strings without float error", () => {
    expect(fromUnits(toUnits("0.100407000000"))).toBe("0.100407");
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(sub("5", "5.000001")).toBe("-0.000001");
    expect(mul("398.37860906", "0.100407")).toBe("40.00000099988742");
    expect(div("40", "0.100407")).toBe("398.378599101656259025");
  });

  it("rounds to tick and step sizes", () => {
    expect(floorTo("0.1009999", "0.000001")).toBe("0.100999");
    expect(ceilTo("0.1009991", "0.000001")).toBe("0.101");
    expect(floorTo("49.9", "1")).toBe("49");
  });

  it("applies basis points and compares", () => {
    expect(applyBps("0.1", 50)).toBe("0.1005");
    expect(applyBps("0.1", -50)).toBe("0.0995");
    expect(cmp("1.0", "1")).toBe(0);
    expect(cmp("0.99", "1")).toBe(-1);
  });

  it("rejects non-decimals", () => {
    expect(() => toUnits("1e3")).toThrow();
    expect(() => toUnits("")).toThrow();
  });

  it("converts JSON numbers exactly, including exponent notation", () => {
    expect(toDecimalString(0.1)).toBe("0.1");
    expect(toDecimalString(1e-7)).toBe("0.0000001");
    expect(toDecimalString(2.5e21)).toBe("2500000000000000000000");
    expect(() => toUnits(Number.NaN)).toThrow();
  });

  it("rounds negative values toward the correct side", () => {
    expect(floorTo("-1.5", "1")).toBe("-2");
    expect(ceilTo("-1.5", "1")).toBe("-1");
    expect(floorTo("-2", "1")).toBe("-2");
  });
});
