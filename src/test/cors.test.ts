import { describe, expect, it } from "vitest";
import { applyCors, isOriginAllowed } from "../../api/_logger.mjs";

function createMockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    ended: false,
    setHeader(k: string, v: string) {
      this.headers[k] = String(v);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe("CORS origin allowlist helper", () => {
  it("allows configured origins and rejects foreign origins in production", () => {
    const env = {
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://vyn.app, https://staging.vyn.app/",
    };

    expect(isOriginAllowed("https://vyn.app", env)).toBe(true);
    expect(isOriginAllowed("https://staging.vyn.app", env)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", env)).toBe(false);
    expect(isOriginAllowed("http://localhost:8080", env)).toBe(false);
  });

  it("allows localhost origins automatically outside production", () => {
    const env = { NODE_ENV: "development", ALLOWED_ORIGINS: "" };

    expect(isOriginAllowed("http://localhost:8080", env)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:5173", env)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", env)).toBe(false);
  });

  it("echoes allowed Origin and omits CORS headers for unknown origins", () => {
    const env = {
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://vyn.app",
    };

    const allowedRes = createMockRes();
    const handledAllowed = applyCors(
      { method: "POST", headers: { origin: "https://vyn.app" } },
      allowedRes,
      { env }
    );
    expect(handledAllowed).toBe(false);
    expect(allowedRes.headers["Access-Control-Allow-Origin"]).toBe("https://vyn.app");
    expect(allowedRes.headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(allowedRes.headers["Vary"]).toBe("Origin");

    const blockedRes = createMockRes();
    applyCors(
      { method: "POST", headers: { origin: "https://attacker.tld" } },
      blockedRes,
      { env }
    );
    expect(blockedRes.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(blockedRes.headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(blockedRes.headers["Vary"]).toBe("Origin");
  });

  it("handles OPTIONS preflight requests and ends the response", () => {
    const env = { NODE_ENV: "development" };
    const res = createMockRes();
    const handled = applyCors(
      { method: "OPTIONS", headers: { origin: "http://localhost:8080" } },
      res,
      { env }
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:8080");
  });
});
