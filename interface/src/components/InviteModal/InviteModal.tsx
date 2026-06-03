import { useEffect, useState } from "react";
import { Button, Modal } from "@cypher-asi/zui";
import { Check, Copy } from "lucide-react";
import { useAuth } from "../../stores/auth-store";
import { useInviteCodeStore } from "../../stores/invite-code-store";
import { track } from "../../lib/analytics";
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
      className={styles.modalRoot}
      headerClassName={styles.floatingHeader}
    >
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
        <span className={styles.titlePill}>INVITE FRIENDS</span>
        <p className={styles.subtext}>
          Share your code with a friend to get them started on AURA. If they
          subscribe to one of our monthly plans, you'll both receive 5,000 Z
          Credits worth $50 to spend on AI models, image generation, and more.
        </p>

        <div className={styles.codeSection}>
          <div className={styles.codeLabel}>Your invite code</div>
          <div className={styles.codeDisplay}>
            {inviteLoading ? (
              <span className={styles.codeValue}>Loading...</span>
            ) : inviteCode ? (
              <span
                className={styles.codePill}
                onClick={handleCodeClick}
                title="Click to copy"
              >
                {copied ? "Copied!" : inviteCode}
              </span>
            ) : (
              <span className={styles.codeValue}>Unavailable</span>
            )}
          </div>
        </div>

        <Button
          variant="secondary"
          size="md"
          fullWidth
          className={styles.shareButton}
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          onClick={handleCodeClick}
          disabled={!inviteCode}
        >
          {copied ? "Copied!" : "Copy invite code"}
        </Button>
      </div>
    </Modal>
  );
}
