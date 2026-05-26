import { useEffect, useState } from "react";
import { Button, Modal } from "@cypher-asi/zui";
import { Check, Copy, Gift } from "lucide-react";
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
    <Modal isOpen={isOpen} onClose={onClose} title="" size="sm">
      <div className={styles.body}>
        <div className={styles.iconWrap}>
          <Gift size={48} strokeWidth={1.2} />
        </div>

        <h2 className={styles.heading}>INVITE FRIENDS</h2>
        <p className={styles.subtext}>
          Share your code with a friend to get them started on AURA.
        </p>
        <p className={styles.subtext}>
          If they subscribe to one of our monthly plans, you'll both
          receive 5,000 Z Credits worth $50 to spend on AI models,
          image generation, and more.
        </p>

        <div className={styles.codeSection}>
          <div className={styles.codeLabel}>Your invite code</div>
          {inviteLoading ? (
            <span className={styles.codeValue}>Loading...</span>
          ) : inviteCode ? (
            <div className={styles.codeRow}>
              <span
                className={styles.codeClickable}
                onClick={handleCodeClick}
                title="Click to copy"
              >
                {copied ? "Copied!" : inviteCode}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                iconOnly
                aria-label="Copy invite code"
                onClick={handleCodeClick}
              />
            </div>
          ) : (
            <span className={styles.codeValue}>Unavailable</span>
          )}
        </div>
      </div>
    </Modal>
  );
}
