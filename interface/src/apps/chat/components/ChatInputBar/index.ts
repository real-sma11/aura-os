// Phase 1 (public mode): the chat-input bar moved to
// `interface/src/features/chat-ui/ChatInputBar/`. This shim keeps the
// existing `apps/chat` and `apps/agents` call sites — and any third
// party that imported from this path — working without churn.
export * from "../../../../features/chat-ui/ChatInputBar";
