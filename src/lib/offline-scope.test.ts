import { describe, expect, it } from "vitest";
import { isRoleScoped } from "@/lib/offline";

describe("PIN lock cache scope", () => {
  it("keeps the shared catalog and subscription warm", () => {
    expect(isRoleScoped(["products", "b1", false])).toBe(false);
    expect(isRoleScoped(["subscription", "b1"])).toBe(false);
  });
  it("drops buying costs, billing history and reports", () => {
    expect(isRoleScoped(["products", "b1", true])).toBe(true);
    expect(isRoleScoped(["subscription", "history", "b1"])).toBe(true);
    expect(isRoleScoped(["sales", "x"])).toBe(true);
  });
});
