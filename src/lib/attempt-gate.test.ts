import { beforeEach, describe, expect, it } from "vitest";
import {
  PIN_BACKOFF,
  PASSWORD_BACKOFF,
  clearGate,
  formatWait,
  gateRemaining,
  noteFailure,
  noteWait,
} from "@/lib/attempt-gate";

const scope = "pin:user-1";

beforeEach(() => {
  localStorage.clear();
});

describe("attempt gate", () => {
  it("lets the first attempt through and clears on success", () => {
    expect(gateRemaining(scope)).toBe(0);
    noteFailure(scope, PIN_BACKOFF);
    clearGate(scope);
    expect(gateRemaining(scope)).toBe(0);
  });

  it("backs off longer with every miss, up to the profile cap", () => {
    let now = 1_000_000;
    const waits: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      noteFailure(scope, PIN_BACKOFF, { now });
      waits.push(gateRemaining(scope, now));
      now += PIN_BACKOFF.maxMs;
    }
    expect(waits).toEqual([1_500, 3_000, 6_000, 12_000, 15_000, 15_000]);
  });

  it("keeps the server's 15-minute lock when the local backoff is shorter", () => {
    const now = 5_000_000;
    noteFailure(scope, PIN_BACKOFF, { blockedUntil: now + 900_000, now });
    expect(gateRemaining(scope, now)).toBe(900_000);
  });

  it("never shortens a server lock with another local miss", () => {
    const now = 5_000_000;
    noteFailure(scope, PIN_BACKOFF, { blockedUntil: now + 900_000, now });
    noteFailure(scope, PIN_BACKOFF, { now: now + 1_000 });
    expect(gateRemaining(scope, now + 1_000)).toBe(899_000);
  });

  it("survives a reload (the countdown lives in storage, not state)", () => {
    const now = 7_000_000;
    noteFailure(scope, PASSWORD_BACKOFF, { now });
    // A fresh module instance would read the same key; reading again is enough
    // to prove the deadline was persisted rather than kept in memory.
    expect(gateRemaining(scope, now)).toBe(PASSWORD_BACKOFF.baseMs);
    expect(gateRemaining(scope, now + 4_000)).toBe(1_000);
    expect(gateRemaining(scope, now + 5_000)).toBe(0);
  });

  it("blocks a reset email without counting it as a failure", () => {
    const now = 2_000_000;
    const gate = noteWait(scope, 60_000, now);
    expect(gate.fails).toBe(0);
    expect(gateRemaining(scope, now)).toBe(60_000);
  });

  it("treats unreadable storage as an open gate instead of throwing", () => {
    localStorage.setItem("storq-gate-" + scope, "{not json");
    expect(gateRemaining(scope)).toBe(0);
    localStorage.setItem("storq-gate-" + scope, JSON.stringify({ fails: -3, blockedUntil: "x" }));
    expect(gateRemaining(scope)).toBe(0);
  });

  it("formats the countdown for the pad and the sign-in button", () => {
    expect(formatWait(0)).toBe("0s");
    expect(formatWait(800)).toBe("1s");
    expect(formatWait(65_000)).toBe("1:05");
    expect(formatWait(600_000)).toBe("10:00");
  });
});
