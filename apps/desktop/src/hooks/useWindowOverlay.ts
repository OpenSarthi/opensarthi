import { useEffect, useRef, useState } from "react";
import { useAssistantStore } from "../stores/assistantStore";

export function useWindowOverlay() {
  const { isOverlayMode, setOverlayMode, currentPlan, setSnapAlign } = useAssistantStore();
  const [prevTaskRunning, setPrevTaskRunning] = useState(false);

  const originalSize = useRef<{ width: number; height: number } | null>(null);
  const originalPos = useRef<{ x: number; y: number } | null>(null);
  const originalMaximized = useRef<boolean>(false);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When a user manually clicks "Expand" while a task is running, we set this
  // so the auto-collapse effect is suppressed for the lifetime of that task.
  // It resets when a genuinely new task starts from idle.
  const userExpandedDuringTask = useRef(false);

  // ── Auto-collapse / restore effect ────────────────────────────────────────
  useEffect(() => {
    const isTaskRunning = !!currentPlan;

    // Detect a genuinely new task starting from idle
    if (isTaskRunning && !prevTaskRunning) {
      // Fresh task → clear the user-override so we auto-collapse again
      userExpandedDuringTask.current = false;
    }

    if (isTaskRunning && !userExpandedDuringTask.current) {
      // Auto-collapse — unless user already manually expanded this task
      if (!isOverlayMode) {
        setOverlayMode(true);
      }
    } else if (!isTaskRunning && prevTaskRunning) {
      // Task just finished → always restore to full window
      userExpandedDuringTask.current = false;
      if (isOverlayMode) {
        setOverlayMode(false);
      }
    }

    setPrevTaskRunning(isTaskRunning);
  }, [currentPlan, isOverlayMode, prevTaskRunning, setOverlayMode]);

  // ── Window sizing / positioning when overlay mode changes ─────────────────
  useEffect(() => {
    let active = true;
    let unlistenMoved: (() => void) | undefined;

    const handleTransition = async () => {
      try {
        const { getCurrentWindow, primaryMonitor } = await import("@tauri-apps/api/window");
        const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
        const appWindow = getCurrentWindow();

        if (isOverlayMode) {
          // ─── Collapse to Overlay Mode ─────────────────────────────
          const monitor = await primaryMonitor();
          const scale = monitor?.scaleFactor || 1;

          // Save window metrics before shrinking
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
            // Give the WM time to register unmaximize before resizing
            await new Promise(resolve => setTimeout(resolve, 150));
          }

          await appWindow.setAlwaysOnTop(true);

          try {
            await appWindow.setDecorations(false);
          } catch (e) {
            console.warn("Could not set decorations false", e);
          }

          document.body.classList.add("overlay-mode");

          // Resize to overlay strip (280×560)
          const overlayWidth = 280;
          const overlayHeight = 560;
          try {
            await appWindow.setMinSize(new LogicalSize(100, 100));
          } catch (e) {
            console.warn("Could not set min size to 100x100", e);
          }
          await appWindow.setSize(new LogicalSize(overlayWidth, overlayHeight));

          // Position on RIGHT edge of screen by default
          const monitorSizeLogical = monitor
            ? monitor.size.toLogical(scale)
            : { width: 1920, height: 1080 };
          const defaultX = monitorSizeLogical.width - overlayWidth - 8;
          const defaultY = Math.max(40, (monitorSizeLogical.height - overlayHeight) / 2);
          await appWindow.setPosition(new LogicalPosition(defaultX, defaultY));
          setSnapAlign("right");

          // Edge-snapping listener while in overlay mode
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
                const monitorWidth = currentMonitor
                  ? currentMonitor.size.toLogical(currentScale).width
                  : 1920;

                const snapThreshold = 100;
                
                // Get the current snap status from store to know what width we are currently at
                const currentSnap = useAssistantStore.getState().snapAlign;
                const currentWidth = currentSnap === "none" ? 320 : 280;

                let nextSnap: "left" | "right" | "none" = "none";
                let targetWidth = 320;
                let targetHeight = 440;

                if (logicalX < snapThreshold) {
                  nextSnap = "left";
                  targetWidth = 280;
                  targetHeight = 560;
                } else if (monitorWidth - (logicalX + currentWidth) < snapThreshold) {
                  nextSnap = "right";
                  targetWidth = 280;
                  targetHeight = 560;
                } else {
                  nextSnap = "none";
                  targetWidth = 320;
                  targetHeight = 440;
                }

                // Get current actual window size
                const currentSize = await appWindow.innerSize();
                const logicalSize = currentSize.toLogical(currentScale);

                // If snap or size changes, update it
                if (
                  nextSnap !== currentSnap || 
                  Math.abs(logicalSize.width - targetWidth) > 5 || 
                  Math.abs(logicalSize.height - targetHeight) > 5
                ) {
                  await appWindow.setSize(new LogicalSize(targetWidth, targetHeight));
                  
                  if (nextSnap === "left") {
                    await appWindow.setPosition(new LogicalPosition(8, y / currentScale));
                  } else if (nextSnap === "right") {
                    await appWindow.setPosition(
                      new LogicalPosition(monitorWidth - targetWidth - 8, y / currentScale)
                    );
                  }
                  
                  setSnapAlign(nextSnap);
                }
              } catch (err) {
                console.error("Snap error:", err);
              }
            }, 300);
          });
          unlistenMoved = unsub;
        } else {
          // ─── Restore to Full Mode ─────────────────────────────────
          // If the task is still running, this expansion was user-initiated
          if (useAssistantStore.getState().currentPlan) {
            userExpandedDuringTask.current = true;
          }

          await appWindow.setAlwaysOnTop(false);

          try {
            await appWindow.setDecorations(true);
          } catch (e) {
            console.warn("Could not set decorations true", e);
          }

          document.body.classList.remove("overlay-mode");
          setSnapAlign("none");

          try {
            await appWindow.setMinSize(new LogicalSize(800, 600));
          } catch (e) {
            console.warn("Could not restore min size to 800x600", e);
          }

          // Restore saved dimensions
          if (originalSize.current) {
            await appWindow.setSize(
              new LogicalSize(originalSize.current.width, originalSize.current.height)
            );
          } else {
            await appWindow.setSize(new LogicalSize(1100, 700));
          }

          if (originalPos.current) {
            await appWindow.setPosition(
              new LogicalPosition(originalPos.current.x, originalPos.current.y)
            );
          }

          if (originalMaximized.current) {
            await appWindow.maximize();
            // Call setAlwaysOnTop(false) again — Linux WMs need this after maximize
            await appWindow.setAlwaysOnTop(false);
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
