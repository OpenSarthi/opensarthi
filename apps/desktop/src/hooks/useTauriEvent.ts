import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Wrapper around Tauri's event listener that automatically cleans up.
 */
export function useTauriEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void
) {
  useEffect(() => {
    let active = true;
    let unlistenFn: UnlistenFn | undefined;

    listen<T>(event, (e) => {
      if (active) handler(e.payload);
    }).then((fn) => {
      unlistenFn = fn;
      if (!active) {
        unlistenFn();
      }
    });

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [event, handler]);
}
