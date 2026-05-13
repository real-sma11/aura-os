import { MessageSquare } from "lucide-react";
import { ChatAppLeftPanel } from "./components/ChatAppLeftPanel";
import { ChatAppMainPanel } from "./components/ChatAppMainPanel";
import { AgentInfoPanel } from "../agents/AgentInfoPanel";
import { AgentSidekickTaskbar } from "../agents/AgentSidekickTaskbar";
import type { AuraAppModule } from "../types";

/**
 * Chat is a ChatGPT-style app for everyday LLM use. The chat is
 * persisted under the user's super-agent (CEO) + Home project, so it
 * shares a unified history with the Agents app's CEO chat — there is
 * only one canonical "you talking to your assistant" thread store.
 *
 * The sidekick reuses the Agents app's `AgentInfoPanel` and
 * `AgentSidekickTaskbar` (Profile / Chats / Skills / Memory / etc.)
 * pinned to the super-agent. It is collapsed on first visit (see
 * `ChatAppMainPanel`'s first-visit effect) and the user can open it
 * from the titlebar toggle.
 */
export const ChatApp: AuraAppModule = {
  id: "chat",
  label: "Chat",
  icon: MessageSquare,
  basePath: "/chat",
  LeftPanel: ChatAppLeftPanel,
  MainPanel: ChatAppMainPanel,
  ResponsiveControls: ChatAppLeftPanel,
  SidekickPanel: AgentInfoPanel,
  SidekickTaskbar: AgentSidekickTaskbar,
  searchPlaceholder: "Search",
};
