import { Button, Modal, Text } from "@cypher-asi/zui";
import { Loader2 } from "lucide-react";
import styles from "./DeleteAccountConfirmModal.module.css";

/**
 * Confirmation modal for permanent account deletion (App Store Guideline
 * 5.1.1(v)). The copy makes the irreversibility explicit — matching the ZERO
 * mobile app's wording — because ZERO soft-deletes the account in a way that
 * permanently blocks it from signing in again.
 */
export function DeleteAccountConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  deleting,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error: string | null;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Account"
      size="sm"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? (
              <>
                <Loader2 size={14} className={styles.spin} /> Deleting...
              </>
            ) : (
              "Delete Account"
            )}
          </Button>
        </div>
      }
    >
      <Text size="sm">
        Are you sure you want to delete your account? You won&rsquo;t be able to
        recover it later, and you&rsquo;ll be signed out on this device.
      </Text>
      {error && (
        <Text size="xs" className={styles.error}>
          {error}
        </Text>
      )}
    </Modal>
  );
}
