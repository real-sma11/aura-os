import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChatUIStore } from "./chat-ui-store";

const mockLoadPersistedModel = vi.fn(
  (_adapterType?: string, _defaultModel?: string | null, _agentId?: string) =>
    "claude-opus-4-6",
);
const mockHasAgentScopedModel = vi.fn((_agentId: string) => false);
const mockLoadPersistedImageModel = vi.fn((_agentId?: string) => "gpt-image-2");
const mockLoadPersistedVideoModel = vi.fn(
  (_agentId?: string) => "veo-3.1-fast-generate-preview",
);
const mockLoadPersistedThreeDModel = vi.fn(
  (_agentId?: string) => "tripo-v2",
);

vi.mock("../constants/models", () => ({
  availableModelsForAdapter: (_adapterType?: string) => [
    { id: "claude-opus-4-6", label: "Opus 4.6", tier: "opus", mode: "chat" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "sonnet", mode: "chat" },
  ],
  defaultModelForAdapter: (_adapterType?: string) => "claude-opus-4-6",
  loadPersistedModel: (
    adapterType?: string,
    defaultModel?: string | null,
    agentId?: string,
  ) => mockLoadPersistedModel(adapterType, defaultModel, agentId),
  loadPersistedImageModel: (agentId?: string) =>
    mockLoadPersistedImageModel(agentId),
  loadPersistedVideoModel: (agentId?: string) =>
    mockLoadPersistedVideoModel(agentId),
  loadPersistedThreeDModel: (agentId?: string) =>
    mockLoadPersistedThreeDModel(agentId),
  persistModel: vi.fn(),
  hasAgentScopedModel: (agentId: string) => mockHasAgentScopedModel(agentId),
}));

function resetStore() {
  useChatUIStore.setState({ streams: {}, drafts: {} });
}

describe("chat-ui-store", () => {
  beforeEach(() => {
    resetStore();
    try {
      localStorage.clear();
    } catch {
      // localStorage may be unavailable
    }
    mockLoadPersistedModel.mockImplementation(
      (_adapterType?: string, _defaultModel?: string | null, _agentId?: string) =>
        "claude-opus-4-6",
    );
    mockHasAgentScopedModel.mockImplementation(() => false);
    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");
    mockLoadPersistedVideoModel.mockImplementation(
      () => "veo-3.1-fast-generate-preview",
    );
    mockLoadPersistedThreeDModel.mockImplementation(() => "tripo-v2");
  });

  it("init populates selectedModel from persisted value", () => {
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-opus-4-6");
  });

  it("init is idempotent when model already set", () => {
    useChatUIStore.getState().init("stream-1");
    useChatUIStore.getState().setSelectedModel("stream-1", "claude-sonnet-4-6");
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-sonnet-4-6");
  });

  it("setSelectedModel updates the stream and persists", async () => {
    const { persistModel } = await import("../constants/models");
    useChatUIStore.getState().init("stream-1");
    useChatUIStore.getState().setSelectedModel("stream-1", "claude-sonnet-4-6", "default");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-sonnet-4-6");
    expect(persistModel).toHaveBeenCalledWith("claude-sonnet-4-6", "default", undefined);
  });

  it("setSelectedModel forwards agentId to persistModel", async () => {
    const { persistModel } = await import("../constants/models");
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    useChatUIStore
      .getState()
      .setSelectedModel("stream-1", "claude-sonnet-4-6", "default", "agent-xyz");
    expect(persistModel).toHaveBeenCalledWith(
      "claude-sonnet-4-6",
      "default",
      "agent-xyz",
    );
  });

  it("getSelectedModel returns null for unknown stream", () => {
    expect(useChatUIStore.getState().getSelectedModel("unknown")).toBeNull();
  });

  it("setProjectId stores and retrieves project id", () => {
    useChatUIStore.getState().setProjectId("stream-1", "proj-abc");
    expect(useChatUIStore.getState().streams["stream-1"]?.projectId).toBe("proj-abc");
  });

  it("setProjectId with null clears the value", () => {
    useChatUIStore.getState().setProjectId("stream-1", "proj-abc");
    useChatUIStore.getState().setProjectId("stream-1", null);
    expect(useChatUIStore.getState().streams["stream-1"]?.projectId).toBeNull();
  });

  it("syncAvailableModels keeps current model if still valid and matches persisted", () => {
    useChatUIStore.getState().init("stream-1");
    // Pretend the persisted value matches the user's pick (which is
    // what `persistModel` would normally arrange via localStorage on a
    // real run; here both are mocked so we wire the loader to mirror
    // the pick explicitly).
    mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");
    useChatUIStore.getState().setSelectedModel("stream-1", "claude-sonnet-4-6");
    useChatUIStore.getState().syncAvailableModels("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-sonnet-4-6");
  });

  it("syncAvailableModels resets to default when current model is unavailable", () => {
    useChatUIStore.getState().init("stream-1");
    useChatUIStore.getState().setSelectedModel("stream-1", "nonexistent-model");
    useChatUIStore.getState().syncAvailableModels("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-opus-4-6");
  });

  it("multiple streams are independent", () => {
    useChatUIStore.getState().init("stream-a");
    useChatUIStore.getState().init("stream-b");
    useChatUIStore.getState().setSelectedModel("stream-a", "claude-sonnet-4-6");
    expect(useChatUIStore.getState().streams["stream-a"]?.selectedModel).toBe("claude-sonnet-4-6");
    expect(useChatUIStore.getState().streams["stream-b"]?.selectedModel).toBe("claude-opus-4-6");
  });

  it("init re-reads the per-agent value on a later pass after agent metadata resolves", () => {
    // Pass 1: adapter metadata not yet available, so the persisted lookup
    // returns the adapter default.
    mockLoadPersistedModel.mockImplementation(() => "claude-opus-4-6");
    useChatUIStore.getState().init("stream-1", undefined, null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-opus-4-6",
    );

    // Pass 2: the agent's real per-agent value is now discoverable. init
    // must replace the earlier adapter-default install.
    mockHasAgentScopedModel.mockImplementation(() => true);
    mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("init leaves an existing selection alone when the agent has no per-agent key", () => {
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    useChatUIStore
      .getState()
      .setSelectedModel("stream-1", "claude-sonnet-4-6", "default", "agent-xyz");
    // No agent-scoped key recorded; a later init pass must not overwrite
    // the user's current in-memory pick with some stale persisted value.
    mockHasAgentScopedModel.mockImplementation(() => false);
    mockLoadPersistedModel.mockImplementation(() => "claude-opus-4-6");
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("syncAvailableModels upgrades to the per-agent value when it differs from current", () => {
    // Current selection is valid for the adapter but is the adapter
    // default that init installed before metadata resolved. The agent
    // actually has its own remembered value; sync should upgrade to it.
    mockLoadPersistedModel.mockImplementation(() => "claude-opus-4-6");
    useChatUIStore.getState().init("stream-1", undefined, null, "agent-xyz");

    mockHasAgentScopedModel.mockImplementation(() => true);
    mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");
    useChatUIStore
      .getState()
      .syncAvailableModels("stream-1", "default", null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("init seeds the image model when the persisted mode is `image`", () => {
    // The persisted mode lives in localStorage; the real
    // `loadPersistedAgentMode` reads from there. Setting the default
    // mode key to "image" must steer init through the image-model
    // branch (not the chat fallback that would land on Sonnet/Opus).
    localStorage.setItem("aura-selected-mode:default", "image");
    mockLoadPersistedImageModel.mockClear();
    mockLoadPersistedModel.mockClear();
    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");

    useChatUIStore.getState().init("stream-1");

    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe("image");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );
    // The chat-model loader must NOT have been consulted on the
    // image path; otherwise a stale Sonnet id leaks through.
    expect(mockLoadPersistedModel).not.toHaveBeenCalled();
    expect(mockLoadPersistedImageModel).toHaveBeenCalled();
  });

  it("setSelectedMode switching from chat to image installs the image default", () => {
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe("code");

    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");
    useChatUIStore.getState().setSelectedMode("stream-1", "image");

    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe("image");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );
  });

  it("syncAvailableModels keeps the image model when in image mode", () => {
    localStorage.setItem("aura-selected-mode:default", "image");
    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );

    // A chat-adapter sync arrives later (e.g. when adapter metadata
    // resolves). It MUST NOT clobber the image model with a chat one.
    useChatUIStore.getState().syncAvailableModels("stream-1", "default");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );
  });

  it("setSelectedMode switching to video restores the persisted video pick", () => {
    useChatUIStore.getState().init("stream-1");
    mockLoadPersistedVideoModel.mockImplementation(
      () => "dreamina-seedance-2-0-260128",
    );

    useChatUIStore.getState().setSelectedMode("stream-1", "video");

    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe(
      "video",
    );
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "dreamina-seedance-2-0-260128",
    );
  });

  it("setSelectedMode switching to 3D restores the persisted 3D pick", () => {
    useChatUIStore.getState().init("stream-1");
    mockLoadPersistedThreeDModel.mockImplementation(() => "tripo-v2");

    useChatUIStore.getState().setSelectedMode("stream-1", "3d");

    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe(
      "3d",
    );
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "tripo-v2",
    );
  });

  it("init in video mode reads from the video-mode loader, not chat", () => {
    localStorage.setItem("aura-selected-mode:default", "video");
    mockLoadPersistedVideoModel.mockClear();
    mockLoadPersistedModel.mockClear();
    mockLoadPersistedVideoModel.mockImplementation(
      () => "dreamina-seedance-2-0-fast-260128",
    );

    useChatUIStore.getState().init("stream-1");

    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe(
      "video",
    );
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "dreamina-seedance-2-0-fast-260128",
    );
    expect(mockLoadPersistedModel).not.toHaveBeenCalled();
    expect(mockLoadPersistedVideoModel).toHaveBeenCalled();
  });

  it("syncAvailableModels in video mode restores the persisted video pick", () => {
    localStorage.setItem("aura-selected-mode:default", "video");
    mockLoadPersistedVideoModel.mockImplementation(
      () => "veo-3.1-fast-generate-preview",
    );
    useChatUIStore.getState().init("stream-1");

    // Simulate the video pick changing in localStorage (e.g. user
    // picked Seedance in another window) and a sync firing.
    mockLoadPersistedVideoModel.mockImplementation(
      () => "dreamina-seedance-2-0-260128",
    );
    useChatUIStore.getState().syncAvailableModels("stream-1", "default");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "dreamina-seedance-2-0-260128",
    );
  });

  describe("cold boot persistence (close/reopen simulation)", () => {
    it("chat-mode picks survive a fresh in-memory store with only the global key", () => {
      // User picks Sonnet on agent A. `setSelectedModel` calls
      // `persistModel` (mocked here, so we manually set the loader's
      // return value to mirror what a real localStorage round-trip would
      // give us on the next boot).
      useChatUIStore
        .getState()
        .setSelectedModel("stream-1", "claude-sonnet-4-6", "default", "agent-A");

      // Wipe the in-memory store to simulate the desktop app being
      // closed and reopened. localStorage survives, so the persisted
      // loaders still return the user's pick.
      useChatUIStore.setState({ streams: {}, drafts: {} });
      mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");
      mockHasAgentScopedModel.mockImplementation(() => true);

      // First init pass arrives before the agent meta resolves. Even
      // with `defaultModel` pointing at the adapter default
      // (Opus), the persisted lookup must win.
      useChatUIStore
        .getState()
        .init("stream-1", undefined, "claude-opus-4-6", "agent-A");
      expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
        "claude-sonnet-4-6",
      );

      // Second init / sync pass after meta resolves keeps the value.
      useChatUIStore
        .getState()
        .init("stream-1", "default", "claude-opus-4-6", "agent-A");
      useChatUIStore
        .getState()
        .syncAvailableModels("stream-1", "default", "claude-opus-4-6", "agent-A");
      expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
        "claude-sonnet-4-6",
      );
    });

    it("syncAvailableModels restores the global last-pick even for an untouched agent", () => {
      // Untouched agent (no per-agent key), but the global "last user
      // pick" key has Sonnet from somewhere else in the app. Without
      // the gate-drop, sync would happily leave the in-memory adapter
      // default in place.
      mockHasAgentScopedModel.mockImplementation(() => false);
      mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");

      useChatUIStore.getState().init("stream-1");
      // Force the in-memory model to the adapter default to mimic the
      // pre-meta first-render install.
      useChatUIStore.setState((s) => ({
        streams: {
          ...s.streams,
          "stream-1": { ...s.streams["stream-1"]!, selectedModel: "claude-opus-4-6" },
        },
      }));

      useChatUIStore
        .getState()
        .syncAvailableModels("stream-1", "default", null, "fresh-agent");
      expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
        "claude-sonnet-4-6",
      );
    });

    it("video-mode picks survive a cold boot independently of chat-mode picks", () => {
      // User picked Sonnet in chat mode, then Seedance in video mode.
      // Wiping the in-memory store and relaunching in video mode must
      // restore Seedance (NOT the chat key, NOT the adapter default).
      mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");
      mockLoadPersistedVideoModel.mockImplementation(
        () => "dreamina-seedance-2-0-260128",
      );

      useChatUIStore.setState({ streams: {}, drafts: {} });
      localStorage.setItem("aura-selected-mode:default", "video");

      useChatUIStore.getState().init("stream-1", "default", null, "agent-A");
      expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe(
        "video",
      );
      expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
        "dreamina-seedance-2-0-260128",
      );

      // And switching back to chat must restore Sonnet (not Seedance).
      useChatUIStore.getState().setSelectedMode("stream-1", "code");
      expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
        "claude-sonnet-4-6",
      );
    });
  });

  describe("pinnedSourceImage", () => {
    it("starts null on a freshly initialised stream", () => {
      useChatUIStore.getState().init("stream-1");
      expect(
        useChatUIStore.getState().getPinnedSourceImage("stream-1"),
      ).toBeNull();
    });

    it("setPinnedSourceImage stores and clears the per-stream pin", () => {
      useChatUIStore.getState().init("stream-1");
      useChatUIStore.getState().setPinnedSourceImage("stream-1", {
        imageUrl: "https://cdn.example.com/owl.png",
        originalUrl: "https://cdn.example.com/owl-orig.png",
        prompt: "an owl",
      });
      expect(useChatUIStore.getState().getPinnedSourceImage("stream-1")).toEqual({
        imageUrl: "https://cdn.example.com/owl.png",
        originalUrl: "https://cdn.example.com/owl-orig.png",
        prompt: "an owl",
      });
      useChatUIStore.getState().setPinnedSourceImage("stream-1", null);
      expect(
        useChatUIStore.getState().getPinnedSourceImage("stream-1"),
      ).toBeNull();
    });

    it("multiple streams have independent pins", () => {
      useChatUIStore.getState().init("stream-a");
      useChatUIStore.getState().init("stream-b");
      useChatUIStore.getState().setPinnedSourceImage("stream-a", {
        imageUrl: "https://cdn.example.com/a.png",
        prompt: "a",
      });
      expect(
        useChatUIStore.getState().getPinnedSourceImage("stream-a")?.imageUrl,
      ).toBe("https://cdn.example.com/a.png");
      expect(
        useChatUIStore.getState().getPinnedSourceImage("stream-b"),
      ).toBeNull();
    });

    it("setSelectedMode clears the pin when switching away from 3D", () => {
      // Start in 3D with a pin.
      useChatUIStore.getState().init("stream-1");
      useChatUIStore.getState().setSelectedMode("stream-1", "3d");
      useChatUIStore.getState().setPinnedSourceImage("stream-1", {
        imageUrl: "https://cdn.example.com/owl.png",
        prompt: "an owl",
      });
      expect(
        useChatUIStore.getState().getPinnedSourceImage("stream-1"),
      ).not.toBeNull();

      // Switch to a non-3D mode → pin must drop.
      useChatUIStore.getState().setSelectedMode("stream-1", "code");
      expect(
        useChatUIStore.getState().getPinnedSourceImage("stream-1"),
      ).toBeNull();
    });

    it("setSelectedMode preserves the pin when re-entering 3D from another mode", () => {
      // Pin while in 3D, then leave (which clears it), then come back
      // to 3D — the pin stays cleared (we don't restore from history
      // here; that's `ChatPanel`'s seeding effect's job).
      useChatUIStore.getState().init("stream-1");
      useChatUIStore.getState().setSelectedMode("stream-1", "3d");
      useChatUIStore.getState().setPinnedSourceImage("stream-1", {
        imageUrl: "https://cdn.example.com/owl.png",
        prompt: "an owl",
      });
      useChatUIStore.getState().setSelectedMode("stream-1", "code");
      useChatUIStore.getState().setSelectedMode("stream-1", "3d");
      expect(
        useChatUIStore.getState().getPinnedSourceImage("stream-1"),
      ).toBeNull();
    });
  });

  describe("drafts", () => {
    it("getDraft returns an empty string when no draft has been set", () => {
      expect(useChatUIStore.getState().getDraft("stream-1")).toBe("");
    });

    it("setDraft stores a non-empty draft per streamKey", () => {
      useChatUIStore.getState().setDraft("stream-1", "hello");
      useChatUIStore.getState().setDraft("stream-2", "world");
      expect(useChatUIStore.getState().getDraft("stream-1")).toBe("hello");
      expect(useChatUIStore.getState().getDraft("stream-2")).toBe("world");
      expect(useChatUIStore.getState().drafts).toEqual({
        "stream-1": "hello",
        "stream-2": "world",
      });
    });

    it("setDraft removes the entry when the value becomes empty", () => {
      useChatUIStore.getState().setDraft("stream-1", "draft text");
      expect(useChatUIStore.getState().drafts).toHaveProperty("stream-1");
      useChatUIStore.getState().setDraft("stream-1", "");
      expect(useChatUIStore.getState().drafts).not.toHaveProperty("stream-1");
    });

    it("setDraft is a no-op when clearing a stream that has no draft", () => {
      const before = useChatUIStore.getState().drafts;
      useChatUIStore.getState().setDraft("stream-1", "");
      expect(useChatUIStore.getState().drafts).toBe(before);
    });

    it("setDraft skips re-writes when the value is unchanged", () => {
      useChatUIStore.getState().setDraft("stream-1", "same");
      const before = useChatUIStore.getState().drafts;
      useChatUIStore.getState().setDraft("stream-1", "same");
      expect(useChatUIStore.getState().drafts).toBe(before);
    });

    it("each streamKey owns its own draft slot", () => {
      useChatUIStore.getState().setDraft("stream-1", "a");
      useChatUIStore.getState().setDraft("stream-2", "b");
      useChatUIStore.getState().setDraft("stream-1", "");
      expect(useChatUIStore.getState().drafts).toEqual({ "stream-2": "b" });
    });
  });
});
