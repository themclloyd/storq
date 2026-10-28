import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route guard decides only whether the shell renders. These cases pin the
 * part that used to end an outage in the sign-in screen: an expired access
 * token with no network must not be read as "signed out".
 */
const auth = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));

const { currentUserId, forgetDeviceIdentity } = await import("@/lib/auth-session");

const setOnline = (value: boolean) =>
  Object.defineProperty(navigator, "onLine", { value, configurable: true });

beforeEach(() => {
  localStorage.clear();
  forgetDeviceIdentity();
  auth.getClaims.mockReset();
  auth.getSession.mockReset();
  setOnline(true);
});

describe("currentUserId offline fallback", () => {
  it("answers from the remembered device identity without touching the network", async () => {
    localStorage.setItem("storq-auth-user", "user-1");
    setOnline(false);

    await expect(currentUserId()).resolves.toBe("user-1");
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it("keeps the till open when the access token lapsed and the refresh cannot be sent", async () => {
    // Exactly what a reload after an hour offline looks like: a transport
    // failure, then a stored session that supabase-js reports as null.
    localStorage.setItem("storq-auth-user", "user-1");
    auth.getClaims.mockResolvedValue({
      data: null,
      error: new Error("Failed to fetch"),
    });
    auth.getSession.mockResolvedValue({ data: { session: null } });

    await expect(currentUserId()).resolves.toBe("user-1");
  });

  it("reads the subject out of the stored Supabase session on a first offline boot", async () => {
    localStorage.setItem("sb-projectref-auth-token", JSON.stringify({ user: { id: "user-2" } }));
    setOnline(false);

    await expect(currentUserId()).resolves.toBe("user-2");
    expect(localStorage.getItem("storq-auth-user")).toBe("user-2");
  });

  it("still refuses a token the server says is invalid", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: new Error("Invalid JWT") });

    await expect(currentUserId()).resolves.toBeNull();
  });

  it("remembers who signed in once the check succeeds", async () => {
    auth.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-3" } },
      error: null,
    });

    await expect(currentUserId()).resolves.toBe("user-3");
    expect(localStorage.getItem("storq-auth-user")).toBe("user-3");
  });

  it("forgets the device identity on sign-out", async () => {
    localStorage.setItem("storq-auth-user", "user-1");
    setOnline(false);
    await expect(currentUserId()).resolves.toBe("user-1");

    forgetDeviceIdentity();

    // Now a device with no identity and no network reaches the sign-in screen,
    // which is the one case where that is the honest answer.
    await expect(currentUserId()).resolves.toBeNull();
  });
});
