// Phase 1 (public mode): MessageQueue moved to
// `interface/src/features/chat-ui/MessageQueue/`. Shim re-export so
// existing call sites continue to resolve here unchanged.
export { MessageQueue } from "../../../../features/chat-ui/MessageQueue";
