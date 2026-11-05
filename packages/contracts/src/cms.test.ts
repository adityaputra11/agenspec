import { describe, expect, it } from "vitest";
import { OrganizationPolicyInputSchema } from "./cms.js";

const base = { restrictApps: false, allowedApps: [] };

describe("OrganizationPolicyInputSchema timesheetServerUrl", () => {
  it("accepts an https URL, null to clear it, and an absent value to leave it unchanged", () => {
    expect(
      OrganizationPolicyInputSchema.safeParse({
        ...base,
        timesheetServerUrl: "https://example.test/mcp",
      }).success,
    ).toBe(true);
    expect(
      OrganizationPolicyInputSchema.safeParse({ ...base, timesheetServerUrl: null }).success,
    ).toBe(true);
    expect(OrganizationPolicyInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a non-https URL", () => {
    expect(
      OrganizationPolicyInputSchema.safeParse({
        ...base,
        timesheetServerUrl: "http://example.test/mcp",
      }).success,
    ).toBe(false);
    expect(
      OrganizationPolicyInputSchema.safeParse({ ...base, timesheetServerUrl: "not a url" }).success,
    ).toBe(false);
  });
});
