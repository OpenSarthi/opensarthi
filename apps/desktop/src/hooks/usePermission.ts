import { useCallback } from "react";
import { wsClient } from "../lib/ws";
import { usePermissionStore } from "../stores/permissionStore";

/**
 * Provides helpers for responding to permission requests.
 */
export function usePermission() {
  const { pendingRequest, setPendingRequest } = usePermissionStore();

  const respond = useCallback(
    (allow: boolean, remember: boolean = false) => {
      if (!pendingRequest) return;
      wsClient.send("permission_response", {
        request_id: pendingRequest.request_id,
        allow,
        remember,
      });
      setPendingRequest(null);
    },
    [pendingRequest, setPendingRequest]
  );

  return { pendingRequest, respond };
}
