import type { ReactElement } from "react";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { InviteModal } from "../InviteModal/InviteModal";
import styles from "./EarnCreditsButton.module.css";

export function EarnCreditsButton(): ReactElement {
  const inviteModalOpen = useUIModalStore((s) => s.inviteModalOpen);
  const openInviteModal = useUIModalStore((s) => s.openInviteModal);
  const closeInviteModal = useUIModalStore((s) => s.closeInviteModal);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={openInviteModal}
        title="Earn credits by inviting a member"
        aria-label="Refer a member to earn credits"
      >
        <span className={styles.label}>Refer member, earn $50.</span>
      </button>
      <InviteModal isOpen={inviteModalOpen} onClose={closeInviteModal} />
    </>
  );
}
