// Phase 1 (public mode): ChatMessageList moved to
// `interface/src/features/chat-ui/ChatMessageList/`. Shim re-export
// so existing call sites continue to resolve here unchanged.
export * from "../../../../features/chat-ui/ChatMessageList";
