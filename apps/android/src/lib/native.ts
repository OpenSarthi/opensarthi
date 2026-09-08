/**
 * Native bridge helpers — thin wrappers around Capacitor plugins.
 * In a web-only dev environment these are no-ops.
 */

import { Capacitor } from "@capacitor/core";

/** Update the persistent notification to reflect task state. */
export async function updateNotificationTaskState(active: boolean, paused: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // RuntimeServicePlugin is registered in MainActivity.kt
    (Capacitor as any).Plugins?.RuntimeService?.updateTaskState({ active, paused });
  } catch {
    // Plugin not available — non-fatal
  }
}
