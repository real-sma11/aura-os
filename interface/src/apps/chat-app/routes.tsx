import type { RouteObject } from "react-router-dom";
import { ChatAppRoute } from "./components/ChatAppRoute";

/**
 * Routes owned by the Chat app. A single `/chat` route covers both the
 * fresh-canvas case and the historical-session case (driven by the
 * `?session=<id>` query string). The route component is imported
 * eagerly because it shares the `ChatPanel` bundle with the agents and
 * projects apps — splitting it out wouldn't save any bytes in
 * practice.
 */
export const chatAppRoutes: RouteObject[] = [
  { path: "chat", element: <ChatAppRoute /> },
];
