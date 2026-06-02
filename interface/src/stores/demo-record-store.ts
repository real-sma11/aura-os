import { create } from "zustand";
import type { DemoPreflightKind, DemoRecordOptions } from "../shared/api/desktop";

/**
 * Holds the pending "demo recording setup" prompt.
 *
 * `/record_demo` is fire-and-forget from the chat input, so when the native
 * preflight fails (ffmpeg missing, or — on macOS — Screen Recording
 * permission not granted) there is no chat turn to attach an error to. The
 * chat hook drops the failure into this store; `RecordDemoSetupModal`
 * (mounted once in the app shell) renders the matching self-service
 * remediation flow and can retry the original recording with the same
 * instruction + options.
 */
export interface DemoSetupRequest {
  kind: DemoPreflightKind;
  message: string;
  /** Original instruction + options, kept so the modal can retry. */
  instruction: string;
  options?: DemoRecordOptions;
}

interface DemoRecordState {
  setup: DemoSetupRequest | null;
  requestSetup: (request: DemoSetupRequest) => void;
  dismissSetup: () => void;
}

export const useDemoRecordStore = create<DemoRecordState>((set) => ({
  setup: null,
  requestSetup: (request) => set({ setup: request }),
  dismissSetup: () => set({ setup: null }),
}));
