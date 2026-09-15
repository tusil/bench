import { describe, expect, it } from "vitest";
import { appendLogText } from "../shared/utils/logs";

describe("log buffer", () => {
  it("keeps only the newest lines", () => {
    expect(appendLogText("one\ntwo\n", "three\nfour", 3, 1_000)).toBe("two\nthree\nfour");
  });

  it("keeps only the newest characters", () => {
    expect(appendLogText("1234", "5678", 100, 5)).toBe("45678");
  });

  it("appends an unconstrained chunk unchanged", () => {
    expect(appendLogText("one", "\ntwo", 100, 1_000)).toBe("one\ntwo");
  });
});
