import { beforeEach, describe, expect, it } from "vitest";
import {
  mapWireContextContents,
  useContextContentsStore,
} from "./context-contents-store";

describe("useContextContentsStore", () => {
  beforeEach(() => {
    useContextContentsStore.setState({ contentsByStreamKey: {} });
  });

  it("stores and retrieves mapped contents per streamKey", () => {
    useContextContentsStore.getState().setContextContents("k1", {
      systemPrompt: "You are helpful.",
      tools: [],
      skills: [],
      subagents: [],
      mcp: [],
    });
    const entry = useContextContentsStore.getState().contentsByStreamKey.k1;
    expect(entry?.systemPrompt).toBe("You are helpful.");
    expect(entry?.tools).toEqual([]);
  });

  it("clearContextContents removes only the targeted key", () => {
    const s = useContextContentsStore.getState();
    const empty = { tools: [], skills: [], subagents: [], mcp: [] };
    s.setContextContents("k1", { ...empty, systemPrompt: "a" });
    s.setContextContents("k2", { ...empty, systemPrompt: "b" });
    s.clearContextContents("k1");

    const latest = useContextContentsStore.getState();
    expect(latest.contentsByStreamKey.k1).toBeUndefined();
    expect(latest.contentsByStreamKey.k2?.systemPrompt).toBe("b");
  });

  it("mapWireContextContents returns undefined when the payload is missing", () => {
    expect(mapWireContextContents(undefined)).toBeUndefined();
  });

  it("mapWireContextContents rewrites snake_case fields into the camelCase shape", () => {
    const mapped = mapWireContextContents({
      system_prompt: "You are Aura.",
      tools: [{ label: "read_file", text: "Reads a file.", tokens: 18 }],
      skills: [{ label: "babysit", text: "Keep a PR green.", tokens: 22 }],
      subagents: [],
      mcp: [],
    });
    expect(mapped).toEqual({
      systemPrompt: "You are Aura.",
      tools: [{ label: "read_file", text: "Reads a file.", tokens: 18 }],
      skills: [{ label: "babysit", text: "Keep a PR green.", tokens: 22 }],
      subagents: [],
      mcp: [],
    });
  });

  it("defaults missing buckets to empty arrays and an undefined system prompt", () => {
    const mapped = mapWireContextContents({});
    expect(mapped).toEqual({
      systemPrompt: undefined,
      tools: [],
      skills: [],
      subagents: [],
      mcp: [],
    });
  });

  it("treats a null or empty system_prompt as undefined", () => {
    expect(mapWireContextContents({ system_prompt: null })?.systemPrompt).toBeUndefined();
    expect(mapWireContextContents({ system_prompt: "" })?.systemPrompt).toBeUndefined();
  });

  it("fills defensive per-segment defaults for a partial wire segment", () => {
    const mapped = mapWireContextContents({
      tools: [{ label: "only_label" }, { tokens: 7 }],
    });
    expect(mapped?.tools).toEqual([
      { label: "only_label", text: "", tokens: 0 },
      { label: "", text: "", tokens: 7 },
    ]);
  });

  it("returns a non-undefined value for a present-but-empty payload (distinguishes absent from empty)", () => {
    const mapped = mapWireContextContents({ tools: [], skills: [] });
    expect(mapped).not.toBeUndefined();
    expect(mapped?.tools).toEqual([]);
    expect(mapped?.skills).toEqual([]);
  });
});
