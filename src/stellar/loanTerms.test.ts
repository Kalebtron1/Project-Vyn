import { describe, expect, it } from "vitest";
import { loanInterestStroops, minWithdrawOut } from "./contracts";

describe("loanInterestStroops", () => {
  const principal = 10_000_0000n;

  it("scales interest by term and rounds up", () => {
    expect(loanInterestStroops(principal, 1n)).toBe(416667n);
    expect(loanInterestStroops(principal, 3n)).toBe(1250000n);
    expect(loanInterestStroops(principal, 6n)).toBe(2500000n);
    expect(loanInterestStroops(principal, 12n)).toBe(5000000n);
  });
});

describe("minWithdrawOut", () => {
  it("keeps 99% of the quoted amount", () => {
    expect(minWithdrawOut(10_000n)).toBe(9900n);
    expect(minWithdrawOut(0n)).toBe(0n);
  });
});
