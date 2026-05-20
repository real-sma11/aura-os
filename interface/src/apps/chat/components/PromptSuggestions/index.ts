// Phase 1 (public mode): PromptSuggestions moved to
// `interface/src/features/chat-ui/PromptSuggestions/`. Shim re-export
// so existing call sites continue to resolve here unchanged.
export { PromptSuggestions } from "../../../../features/chat-ui/PromptSuggestions/PromptSuggestions";
