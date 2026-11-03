// @vitest-environment node
/**
 * CORS con lista permitida (#94): solo se responde con encabezados CORS a orígenes
 * conocidos, nunca `*`, y el preflight no llega a la lógica del endpoint.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCors, isAllowedOrigin } from "../../api/_cors.mjs";

function fakeRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    ended: false,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
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

beforeEach(() => {
  vi.stubEnv("ALLOWED_ORIGINS", "https://www.projectvyn.dev, https://projectvyn.dev/");
  vi.stubEnv("VERCEL_URL", "vyn-git-abc.vercel.app");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("VERCEL_ENV", "production");
});

afterEach(() => vi.unstubAllEnvs());

describe("applyCors", () => {
  it("echoes an allowed origin with credentials", () => {
    const res = fakeRes();

    expect(applyCors({ method: "POST", headers: { origin: "https://www.projectvyn.dev" } }, res)).toBe(false);
    expect(res.headers).toMatchObject({
      "access-control-allow-origin": "https://www.projectvyn.dev",
      "access-control-allow-credentials": "true",
      vary: "Origin",
    });
  });

  it("sends no CORS headers to a foreign origin", () => {
    const res = fakeRes();

    applyCors({ method: "POST", headers: { origin: "https://evil.example" } }, res);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("answers the preflight without running the endpoint", () => {
    const res = fakeRes();

    expect(applyCors({ method: "OPTIONS", headers: { origin: "https://evil.example" } }, res)).toBe(true);
    expect(res).toMatchObject({ statusCode: 204, ended: true });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows the deployment's own Vercel URL", () => {
    expect(isAllowedOrigin("https://vyn-git-abc.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://projectvyn.dev")).toBe(true);
    expect(isAllowedOrigin("https://other.vercel.app")).toBe(false);
  });

  it("allows localhost only outside production", () => {
    expect(isAllowedOrigin("http://localhost:8080")).toBe(false);

    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isAllowedOrigin("http://localhost:8080")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isAllowedOrigin("http://localhost.evil.example")).toBe(false);
  });
});

describe("handlers", () => {
  it("no handler sends a wildcard origin", () => {
    const api = join(process.cwd(), "api");
    for (const file of readdirSync(api)) {
      expect(readFileSync(join(api, file), "utf8"), file).not.toMatch(/Access-Control-Allow-Origin['"],\s*['"]\*/);
    }
  });
});
