import { useEffect, useState } from "react";
import { Button, Modal } from "@cypher-asi/zui";
import { Check, Copy } from "lucide-react";
import { useAuth } from "../../stores/auth-store";
import { useInviteCodeStore } from "../../stores/invite-code-store";
import { track } from "../../lib/analytics";
import { GlassCard } from "../GlassCard";
import styles from "./InviteModal.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const INVITE_URL = "https://aura.ai/download";

export function InviteModal({ isOpen, onClose }: Props) {
  const { user } = useAuth();
  const userId = user?.user_id ?? null;
  const inviteCode = useInviteCodeStore((s) => s.code);
  const inviteLoading = useInviteCodeStore((s) => s.loading);
  const ensureInviteCode = useInviteCodeStore((s) => s.ensure);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !userId) return;
    void ensureInviteCode(userId);
  }, [isOpen, userId, ensureInviteCode]);

  useEffect(() => {
    if (!isOpen) setCopied(false);
  }, [isOpen]);

  const handleCodeClick = () => {
    if (!inviteCode) return;
    const text = `Join me on AURA — use my invite code: ${inviteCode}\n${INVITE_URL}`;
    navigator.clipboard.writeText(text);
    track("invite_code_copied", { source: "invite_modal" });
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="sm"
      noPadding
      className={styles.modalShell}
      contentClassName={styles.modalContent}
      headerClassName={styles.floatingHeader}
    >
      <GlassCard className={styles.card}>
        <div className={styles.videoBanner}>
          <video
            className={styles.bannerVideo}
            src="/AURA_visual_loop.mp4"
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
          />
          <div className={styles.bannerGlow} aria-hidden="true" />
        </div>
        <div className={styles.body}>
          <span className={styles.titlePill}>
            <img
              src="/AURA_logo_text_mark.png"
              alt="AURA"
              className={styles.wordmark}
              draggable={false}
            />
          </span>
          <p className={styles.subtext}>
            Share your code with a friend.
            <br />
            If they subscribe, you'll both receive $50 to spend on frontier AI.
          </p>

          <Button
            variant="secondary"
            size="md"
            rounded="lg"
            className={styles.shareButton}
            icon={inviteCode ? (copied ? <Check size={16} /> : <Copy size={16} />) : undefined}
            onClick={handleCodeClick}
            disabled={!inviteCode}
            title="Click to copy your invite code"
          >
            {inviteLoading
              ? "Loading..."
              : !inviteCode
                ? "Unavailable"
                : copied
                  ? "Copied!"
                  : inviteCode}
          </Button>
        </div>
      </GlassCard>
    </Modal>
  );
}
