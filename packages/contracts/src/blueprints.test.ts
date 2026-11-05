import { describe, expect, it } from "vitest";
import { AgentBlueprintInputSchema, SPEC_BLUEPRINT_TEMPLATE } from "./blueprints.js";

describe("Spec blueprint template", () => {
  it("is a valid blueprint an admin can save as is", () => {
    expect(AgentBlueprintInputSchema.parse(SPEC_BLUEPRINT_TEMPLATE)).toEqual(
      SPEC_BLUEPRINT_TEMPLATE,
    );
  });
});
