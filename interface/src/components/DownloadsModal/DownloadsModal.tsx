import { Modal } from "@cypher-asi/zui";
import { DownloadView } from "../../views/marketing/DownloadView";

export function DownloadsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Downloads" size="xl" fullHeight>
      <DownloadView />
    </Modal>
  );
}
