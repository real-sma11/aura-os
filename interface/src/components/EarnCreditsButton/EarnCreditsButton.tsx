import { useUIModalStore } from "../../stores/ui-modal-store";
import { InviteModal } from "../InviteModal/InviteModal";
import styles from "./EarnCreditsButton.module.css";

export function EarnCreditsButton() {
  const inviteModalOpen = useUIModalStore((s) => s.inviteModalOpen);
  const openInviteModal = useUIModalStore((s) => s.openInviteModal);
  const closeInviteModal = useUIModalStore((s) => s.closeInviteModal);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={openInviteModal}
        title="Earn credits by inviting a friend"
        aria-label="Earn credits"
      >
        <span className={styles.label}>EARN CREDITS</span>
      </button>
      <InviteModal isOpen={inviteModalOpen} onClose={closeInviteModal} />
    </>
  );
}
