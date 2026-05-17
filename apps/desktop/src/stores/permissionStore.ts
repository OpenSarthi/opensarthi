import { create } from "zustand";
import type { PermissionRequest } from "../lib/schemas";

interface PermissionState {
  pendingRequest: PermissionRequest | null;
  setPendingRequest: (req: PermissionRequest | null) => void;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  pendingRequest: null,
  setPendingRequest: (pendingRequest) => set({ pendingRequest }),
}));
