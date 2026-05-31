import { useEffect, useRef, useState } from "react";
import { useAssistantStore } from "../stores/assistantStore";

export function useWindowOverlay() {
  const { isOverlayMode, setOverlayMode, currentPlan, setSnapAlign } = useAssistantStore();
  const isTaskRunning = !!currentPlan;
  const [prevTaskRunning, setPrevTaskRunning] = useState(false);

  const originalSize = useRef<{ width: number; height: number } | null>(null);
  const originalPos = useRef<{ x: number; y: number } | null>(null);
  const originalMaximized = useRef<boolean>(false);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-collapse to overlay mode when a task starts, and auto-restore to full window when completed.
  useEffect(() => {
    if (isTaskRunning && !prevTaskRunning) {
      setOverlayMode(true);
    } else if (!isTaskRunning && prevTaskRunning) {
      setOverlayMode(false);
    }
    setPrevTaskRunning(isTaskRunning);
  }, [isTaskRunning, prevTaskRunning, setOverlayMode]);

  // Handle window sizing and positioning when overlay mode toggles.
  useEffect(() => {
    let active = true;
    let unlistenMoved: (() => void) | undefined;

    const handleTransition = async () => {
      try {
        const { getCurrentWindow, primaryMonitor } = await import("@tauri-apps/api/window");
        const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
        const appWindow = getCurrentWindow();

        if (isOverlayMode) {
          // ─── Transition to Overlay Mode ───
          const monitor = await primaryMonitor();
          const scale = monitor?.scaleFactor || 1;

          // Save current window metrics
          const maximized = await appWindow.isMaximized();
          originalMaximized.current = maximized;

          const outerSize = await appWindow.outerSize();
          const logicalSize = outerSize.toLogical(scale);
          originalSize.current = { width: logicalSize.width, height: logicalSize.height };

          const outerPos = await appWindow.outerPosition();
          const logicalPos = outerPos.toLogical(scale);
          originalPos.current = { x: logicalPos.x, y: logicalPos.y };

          if (maximized) {
            await appWindow.unmaximize();
          }

          await appWindow.setAlwaysOnTop(true);
          
          try {
            await appWindow.setDecorations(false);
          } catch (e) {
            console.warn("Could not set decorations false", e);
          }

          document.body.classList.add("overlay-mode");

          // Resize window to overlay size
          const overlayWidth = 280;
          const overlayHeight = 560;
          try {
            await appWindow.setMinSize(new LogicalSize(100, 100));
          } catch (e) {
            console.warn("Could not set min size to 100x100", e);
          }
          await appWindow.setSize(new LogicalSize(overlayWidth, overlayHeight));

          // Position to right side of screen by default
          const monitorSizeLogical = monitor ? monitor.size.toLogical(scale) : { width: 1920, height: 1080 };
          const defaultX = monitorSizeLogical.width - overlayWidth - 8;
          const defaultY = Math.max(40, (monitorSizeLogical.height - overlayHeight) / 2);
          await appWindow.setPosition(new LogicalPosition(defaultX, defaultY));
          setSnapAlign("right");

          // Listen for movement to perform left/right edge snapping
          const unsub = await appWindow.onMoved(async (event) => {
            if (!active) return;
            const { x, y } = event.payload; // PhysicalPosition

            if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
            snapTimerRef.current = setTimeout(async () => {
              if (!active) return;
              try {
                const currentMonitor = await primaryMonitor();
                const currentScale = currentMonitor?.scaleFactor || 1;
                const logicalX = x / currentScale;
                const monitorWidth = currentMonitor ? currentMonitor.size.toLogical(currentScale).width : 1920;

                // Snapping threshold of 100px
                const snapThreshold = 100;
                if (logicalX < snapThreshold) {
                  // Snap to LEFT edge
                  await appWindow.setPosition(new LogicalPosition(8, y / currentScale));
                  setSnapAlign("left");
                } else if (monitorWidth - (logicalX + overlayWidth) < snapThreshold) {
                  // Snap to RIGHT edge
                  await appWindow.setPosition(new LogicalPosition(monitorWidth - overlayWidth - 8, y / currentScale));
                  setSnapAlign("right");
                } else {
                  setSnapAlign("none");
                }
              } catch (err) {
                console.error("Snap error:", err);
              }
            }, 300);
          });
          unlistenMoved = unsub;
        } else {
          // ─── Transition back to Full Mode ───
          await appWindow.setAlwaysOnTop(false);
          
          try {
            await appWindow.setDecorations(true);
          } catch (e) {
            console.warn("Could not set decorations true", e);
          }

          document.body.classList.remove("overlay-mode");

          try {
            await appWindow.setMinSize(new LogicalSize(800, 600));
          } catch (e) {
            console.warn("Could not restore min size to 800x600", e);
          }

          // Restore saved dimensions
          if (originalSize.current) {
            await appWindow.setSize(new LogicalSize(originalSize.current.width, originalSize.current.height));
          } else {
            await appWindow.setSize(new LogicalSize(1100, 700));
          }

          if (originalPos.current) {
            await appWindow.setPosition(new LogicalPosition(originalPos.current.x, originalPos.current.y));
          }

          if (originalMaximized.current) {
            await appWindow.maximize();
          }

          await appWindow.setFocus();
        }
      } catch (err) {
        console.error("Error managing window overlay transition:", err);
      }
    };

    handleTransition();

    return () => {
      active = false;
      if (unlistenMoved) unlistenMoved();
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    };
  }, [isOverlayMode]);

  return { isOverlayMode, setOverlayMode };
}
