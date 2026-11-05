import { describe, expect, it } from "vitest";
import { colorForUserId, PEOPLE_COLORS, pickPeopleColor } from "./ids.js";

describe("people colors", () => {
  it("picks from the palette", () => {
    expect(PEOPLE_COLORS).toContain(pickPeopleColor(() => 0));
    expect(PEOPLE_COLORS).toContain(pickPeopleColor(() => 0.999));
  });

  it("falls back to a stable palette color per account", () => {
    const first = colorForUserId("user-rina");
    expect(PEOPLE_COLORS).toContain(first);
    expect(colorForUserId("user-rina")).toBe(first);
    expect(colorForUserId("user-dimas")).not.toBe(colorForUserId("user-sari"));
  });
});
