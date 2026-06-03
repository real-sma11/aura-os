import { useEffect, useMemo, useRef, useState } from "react";
import { FollowEditButton } from "../../../components/FollowEditButton";
import type { Agent } from "../../../shared/types";
import { useAvatarState } from "../../../hooks/use-avatar-state";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import { useOrgStore } from "../../../stores/org-store";
import { useRemoteAgentState } from "../../../hooks/use-remote-agent-state";
import { useEnvironmentInfo } from "../../../hooks/use-environment-info";
import { useAgentSidekickStore, type AgentSidekickTab } from "../stores/agent-sidekick-store";
import {
  createProfileCardScene,
  type ProfileCardScene,
} from "./profile-card-scene";
import {
  drawInfoLinks,
  drawInfoStrip,
  drawProfileCardTexture,
  loadCardAvatar,
} from "./profile-card-texture";
import styles from "./AgentInfoPanel.module.css";

/** A clickable navigation link drawn on the backplate. */
export interface ProfileSectionLink {
  id: AgentSidekickTab;
  label: string;
  count: number;
}

/** Normalized statuses that should not read as "online". */
const OFFLINE_STATUSES = new Set([
  "stopped",
  "stopping",
  "hibernating",
  "error",
  "archived",
  "offline",
]);

function readAccent(el: HTMLElement): string {
  const value = getComputedStyle(el).getPropertyValue("--color-accent").trim();
  return value || "#6366f1";
}

function readLineColor(el: HTMLElement): string {
  const value = getComputedStyle(el).getPropertyValue("--color-card-line").trim();
  return value || "#cfe8ff";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface ProfileCard3DProps {
  agent: Agent;
  isOwnAgent: boolean;
  sections?: ProfileSectionLink[];
}

export function ProfileCard3D({ agent, isOwnAgent, sections = [] }: ProfileCard3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ProfileCardScene | null>(null);
  const [ready, setReady] = useState(false);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);

  // Live agent status for the blinking dot (registers the agent so the central
  // status store polls/streams it even if no list view mounted it).
  useEffect(() => {
    const store = useProfileStatusStore.getState();
    store.registerAgents([{ id: agent.agent_id, machineType: agent.machine_type }]);
    if (agent.machine_type === "remote") {
      store.registerRemoteAgents([{ agent_id: agent.agent_id }]);
    }
  }, [agent.agent_id, agent.machine_type]);

  const { status } = useAvatarState(agent.agent_id);
  const isOnline = !status || !OFFLINE_STATUSES.has(status);

  const orgName = useOrgStore((s) =>
    agent.org_id ? s.orgs.find((o) => o.org_id === agent.org_id)?.name ?? null : null,
  );

  // IP: remote agents expose a VM endpoint; local agents fall back to the host
  // machine IP. Both hooks are called unconditionally (rules of hooks).
  const remote = useRemoteAgentState(
    agent.machine_type === "remote" ? agent.agent_id : undefined,
  );
  const env = useEnvironmentInfo();
  const ip = useMemo(
    () =>
      agent.machine_type === "remote"
        ? remote.data?.endpoint ?? null
        : env.data?.ip ?? null,
    [agent.machine_type, remote.data?.endpoint, env.data?.ip],
  );

  // Create the WebGL scene once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: ProfileCardScene | null = null;
    try {
      scene = createProfileCardScene(host, {
        accent: readAccent(host),
        lineColor: readLineColor(host),
        reducedMotion: prefersReducedMotion(),
      });
    } catch {
      sceneRef.current = null;
      return;
    }
    sceneRef.current = scene;
    setReady(true);
    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the avatar (CORS-clean) for the LCD.
  useEffect(() => {
    let cancelled = false;
    setAvatar(null);
    loadCardAvatar(agent.icon).then((img) => {
      if (!cancelled) setAvatar(img);
    });
    return () => {
      cancelled = true;
    };
  }, [agent.icon]);

  // Redraw the LCD texture whenever inputs change.
  useEffect(() => {
    const scene = sceneRef.current;
    const host = hostRef.current;
    if (!ready || !scene || !host) return;
    drawProfileCardTexture(scene.screenCanvas, {
      agent,
      accent: readAccent(host),
      avatar,
    });
    scene.setLineColor(readLineColor(host));
    scene.refreshTexture();
  }, [ready, agent, avatar]);

  // Draw the agent info strip on the worn-metal backplate. Registers a renderer
  // so the scene can redraw it on each status-dot blink.
  useEffect(() => {
    const scene = sceneRef.current;
    const host = hostRef.current;
    if (!ready || !scene || !host) return;
    const accent = readAccent(host);
    scene.setInfoRenderer((dotOn) => {
      drawInfoStrip(
        scene.infoCanvas,
        {
          name: agent.name,
          role: agent.role,
          statusLabel: isOnline ? "Online" : "Offline",
          isOnline,
          orgName,
          ip,
          wallet: agent.wallet_address ?? null,
          accent,
        },
        dotOn,
      );
    });
  }, [ready, agent.name, agent.role, isOnline, orgName, ip, agent.wallet_address]);

  // Navigation links on the lower backplate: draw rows + wire clicks to tabs.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    scene.setLinks(
      sections.length,
      (index) => {
        const section = sections[index];
        if (section) useAgentSidekickStore.getState().setActiveTab(section.id);
      },
      (hovered) => {
        drawInfoLinks(
          scene.linksCanvas,
          sections.map((s) => ({ label: s.label, count: s.count })),
          hovered,
        );
      },
    );
  }, [ready, sections]);

  return (
    <div className={styles.card3dContainer}>
      <div ref={hostRef} className={styles.cardCanvasHost} />
      {!isOwnAgent && (
        <div className={styles.card3dActions}>
          <FollowEditButton isOwner={false} targetProfileId={agent.profile_id} />
        </div>
      )}
    </div>
  );
}
