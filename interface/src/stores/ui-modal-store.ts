import { create } from "zustand";
import { INSUFFICIENT_CREDITS_EVENT } from "../api/client";

interface UIModalState {
  orgSettingsOpen: boolean;
  orgInitialSection: "billing" | undefined;
  buyCreditsOpen: boolean;
  hostSettingsOpen: boolean;
  appsModalOpen: boolean;
  inviteModalOpen: boolean;

  openOrgSettings: () => void;
  closeOrgSettings: () => void;
  openOrgBilling: () => void;
  openBuyCredits: () => void;
  closeBuyCredits: () => void;
  openHostSettings: () => void;
  closeHostSettings: () => void;
  openAppsModal: () => void;
  closeAppsModal: () => void;
  openInviteModal: () => void;
  closeInviteModal: () => void;
}

export const useUIModalStore = create<UIModalState>()((set) => ({
  orgSettingsOpen: false,
  orgInitialSection: undefined,
  buyCreditsOpen: false,
  hostSettingsOpen: false,
  appsModalOpen: false,
  inviteModalOpen: false,

  openOrgSettings: () => set({ orgSettingsOpen: true }),
  closeOrgSettings: () => set({ orgSettingsOpen: false, orgInitialSection: undefined }),
  openOrgBilling: () => set({ orgSettingsOpen: true, orgInitialSection: "billing" }),
  openBuyCredits: () => set({ buyCreditsOpen: true }),
  closeBuyCredits: () => set({ buyCreditsOpen: false }),
  openHostSettings: () => set({ hostSettingsOpen: true }),
  closeHostSettings: () => set({ hostSettingsOpen: false }),
  openAppsModal: () => set({ appsModalOpen: true }),
  closeAppsModal: () => set({ appsModalOpen: false }),
  openInviteModal: () => set({ inviteModalOpen: true }),
  closeInviteModal: () => set({ inviteModalOpen: false }),
}));

if (typeof window !== "undefined") {
  window.addEventListener(INSUFFICIENT_CREDITS_EVENT, () => {
    useUIModalStore.getState().openBuyCredits();
  });
}
