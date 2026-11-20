import { describe, expect, it } from "vitest";
import { LoginError, loginErrorFromStatus } from "./login-error";

describe("Anmeldefehler unterscheiden", () => {
  it("ordnet SDK-Status zu", () => {
    expect(loginErrorFromStatus(400)).toBeNull(); // falsche Zugangsdaten
    expect(loginErrorFromStatus(0)).toBe("offline");
    expect(loginErrorFromStatus(undefined)).toBe("offline");
    expect(loginErrorFromStatus(429)).toBe("rate_limited");
    expect(loginErrorFromStatus(502)).toBe("server");
    expect(loginErrorFromStatus(418)).toBe("unknown");
  });
  it("trägt Ursache und Text", () => {
    const e = new LoginError("no_studio");
    expect(e).toBeInstanceOf(Error);
    expect(e.reason).toBe("no_studio");
    expect(e.message).toContain("keinem Büro");
  });
});
