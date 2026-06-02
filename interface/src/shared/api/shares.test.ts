import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSessionShare,
  getPublicShare,
  isValidShareToken,
  ShareNotFoundError,
} from "./shares";
import { ApiClientError } from "./core";

vi.mock("../../shared/lib/host-config", () => ({
  resolveApiUrl: (path: string) => path,
}));

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? "application/json" : null,
    },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

const share = {
  shareId: "t_6a1e3d8f6e548191948c1f0a9c68cbda",
  url: "https://aura.ai/s/t_6a1e3d8f6e548191948c1f0a9c68cbda",
};

describe("createSessionShare", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs to the session share endpoint and returns the narrowed share", async () => {
    const fetchMock = mockFetch(200, share);
    globalThis.fetch = fetchMock;

    const result = await createSessionShare({
      projectId: "p1",
      agentInstanceId: "ai1",
      sessionId: "s1",
    });

    expect(result).toEqual(share);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1/sessions/s1/share",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when the response is missing shareId/url", async () => {
    globalThis.fetch = mockFetch(200, { foo: "bar" });
    await expect(
      createSessionShare({
        projectId: "p1",
        agentInstanceId: "ai1",
        sessionId: "s1",
      }),
    ).rejects.toThrow("Unexpected response");
  });

  it("propagates ApiClientError on a failed request", async () => {
    globalThis.fetch = mockFetch(403, {
      error: "Forbidden",
      code: "forbidden",
      details: null,
    });
    await expect(
      createSessionShare({
        projectId: "p1",
        agentInstanceId: "ai1",
        sessionId: "s1",
      }),
    ).rejects.toThrow(ApiClientError);
  });
});

const VALID_TOKEN = "t_6a1e3d8f6e548191948c1f0a9c68cbda";

const sessionEvents = [
  {
    event_id: "e1",
    agent_instance_id: "a1",
    project_id: "p1",
    role: "user",
    content: "hi",
    created_at: "2024-01-01T00:00:00Z",
  },
];

describe("isValidShareToken", () => {
  it("accepts a well-formed t_<32hex> token", () => {
    expect(isValidShareToken(VALID_TOKEN)).toBe(true);
  });

  it("rejects malformed tokens", () => {
    expect(isValidShareToken("")).toBe(false);
    expect(isValidShareToken("t_short")).toBe(false);
    expect(isValidShareToken("nope")).toBe(false);
    // Uppercase hex is not accepted (server emits lowercase only).
    expect(isValidShareToken("t_6A1E3D8F6E548191948C1F0A9C68CBDA")).toBe(false);
    // Right length but contains a non-hex char.
    expect(isValidShareToken("t_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });
});

describe("getPublicShare", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects a malformed token without touching the network", async () => {
    const fetchMock = mockFetch(200, sessionEvents);
    globalThis.fetch = fetchMock;
    await expect(getPublicShare("not-valid")).rejects.toBeInstanceOf(
      ShareNotFoundError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GETs the public endpoint and returns the narrowed transcript", async () => {
    const fetchMock = mockFetch(200, sessionEvents);
    globalThis.fetch = fetchMock;

    const result = await getPublicShare(VALID_TOKEN);

    expect(result).toEqual(sessionEvents);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/share/${VALID_TOKEN}`,
      expect.objectContaining({ method: "GET" }),
    );
    // The public read path must NOT attach an Authorization header.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("maps a 404 to ShareNotFoundError", async () => {
    globalThis.fetch = mockFetch(404, { error: "share not found" });
    await expect(getPublicShare(VALID_TOKEN)).rejects.toBeInstanceOf(
      ShareNotFoundError,
    );
  });

  it("throws on a shape mismatch (response is not a SessionEvent[])", async () => {
    globalThis.fetch = mockFetch(200, { not: "an array" });
    await expect(getPublicShare(VALID_TOKEN)).rejects.toThrow(
      /Unexpected response/,
    );
  });

  it("throws a generic error on a non-404 failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "boom" });
    await expect(getPublicShare(VALID_TOKEN)).rejects.toThrow(
      /Failed to load shared session/,
    );
  });
});
