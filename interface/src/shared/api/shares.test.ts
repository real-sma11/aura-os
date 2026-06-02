import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSessionShare } from "./shares";
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
