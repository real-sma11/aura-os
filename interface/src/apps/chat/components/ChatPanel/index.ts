// Phase 1 (public mode): ChatPanel moved to
// `interface/src/features/chat-ui/ChatPanel/`. Shim re-export so
// existing `apps/chat` and `apps/agents` call sites stay valid.
export * from "../../../../features/chat-ui/ChatPanel";
