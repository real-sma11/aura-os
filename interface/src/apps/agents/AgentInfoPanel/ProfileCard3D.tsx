import { useEffect, useRef, useState } from "react";
import { FollowEditButton } from "../../../components/FollowEditButton";
import type { Agent } from "../../../shared/types";
import {
  createProfileCardScene,
  type ProfileCardScene,
} from "./profile-card-scene";
import { drawProfileCardTexture, loadCardAvatar } from "./profile-card-texture";
import styles from "./AgentInfoPanel.module.css";

const HORIZONTAL_THRESHOLD = 460;

function readAccent(el: HTMLElement): string {
  const value = getComputedStyle(el).getPropertyValue("--color-accent").trim();
  return value || "#6366f1";
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
  /** Force landscape (sidekick split-screen). Also flips when the lane is wide. */
  splitScreen: boolean;
}

export function ProfileCard3D({ agent, isOwnAgent, splitScreen }: ProfileCard3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ProfileCardScene | null>(null);
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(false);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);

  const horizontal = splitScreen || wide;

  // Create the WebGL scene once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: ProfileCardScene | null = null;
    try {
      scene = createProfileCardScene(host, {
        horizontal: splitScreen,
        accent: readAccent(host),
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

  // Track the lane width to flip orientation on manual resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setWide(host.clientWidth >= HORIZONTAL_THRESHOLD);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
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
    scene.setOrientation(horizontal);
    drawProfileCardTexture(scene.screenCanvas, {
      agent,
      accent: readAccent(host),
      avatar,
      horizontal,
    });
    scene.refreshTexture();
  }, [ready, agent, avatar, horizontal]);

  return (
    <div className={styles.card3dContainer}>
      <div
        ref={hostRef}
        className={`${styles.cardCanvasHost}${horizontal ? ` ${styles.cardCanvasHostHorizontal}` : ""}`}
      />
      {!isOwnAgent && (
        <div className={styles.card3dActions}>
          <FollowEditButton isOwner={false} targetProfileId={agent.profile_id} />
        </div>
      )}
    </div>
  );
}
