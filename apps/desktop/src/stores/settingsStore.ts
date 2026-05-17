import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Settings } from "../lib/schemas";
import { SettingsSchema } from "../lib/schemas";

interface SettingsState {
  settings: Settings;
  updateSettings: (partial: Partial<Settings>) => void;
  resetSettings: () => void;
}

const defaults = SettingsSchema.parse({});

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: defaults,
      updateSettings: (partial) =>
        set((s) => ({
          settings: SettingsSchema.parse({ ...s.settings, ...partial }),
        })),
      resetSettings: () => set({ settings: defaults }),
    }),
    { name: "opensarthi-settings" }
  )
);
