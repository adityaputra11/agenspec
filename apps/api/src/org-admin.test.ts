import { describe, expect, it } from "vitest";
import { isAppAllowed, orgAdminRoles } from "./org-admin.js";

describe("orgAdminRoles", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    [" admin ", true],
    ["owner,member", true],
    ["member", false],
    ["", false],
  ])("treats %j as admin: %s", (role, expected) => {
    expect(orgAdminRoles(role)).toBe(expected);
  });
});

describe("isAppAllowed", () => {
  it("allows every app without a policy", () => {
    expect(isAppAllowed(null, "gmail")).toBe(true);
  });

  it("allows every app when restrictions are off", () => {
    expect(isAppAllowed({ restrictApps: false, allowedApps: ["gmail"] }, "slack")).toBe(true);
  });

  it("allows only listed apps when restrictions are on", () => {
    const policy = { restrictApps: true, allowedApps: ["gmail", "googledrive"] };
    expect(isAppAllowed(policy, "gmail")).toBe(true);
    expect(isAppAllowed(policy, "slack")).toBe(false);
  });

  it("matches app slugs case-insensitively", () => {
    const policy = { restrictApps: true, allowedApps: ["googledrive"] };
    expect(isAppAllowed(policy, "GoogleDrive")).toBe(true);
  });

  it("blocks every app when restrictions are on and the list is empty", () => {
    expect(isAppAllowed({ restrictApps: true, allowedApps: [] }, "gmail")).toBe(false);
  });
});
