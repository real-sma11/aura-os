import { Modal } from "@cypher-asi/zui";
import { ChangelogView } from "../../views/marketing/ChangelogView";

export function ChangelogModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Changelog" size="xl" fullHeight>
      <ChangelogView />
    </Modal>
  );
}
