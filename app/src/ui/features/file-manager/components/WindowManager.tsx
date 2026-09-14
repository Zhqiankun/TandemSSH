/* eslint-disable react-refresh/only-export-components */
import React, { useState, useCallback, useRef, useId } from "react";
import { useTranslation } from "react-i18next";

export interface WindowInstance {
  id: string;
  title: string;
  component: React.ReactNode | ((windowId: string) => React.ReactNode);
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
}

interface WindowManagerProps {
  children?: React.ReactNode;
}

interface WindowManagerContextType {
  windows: WindowInstance[];
  openWindow: (window: Omit<WindowInstance, "id" | "zIndex">) => string;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<WindowInstance>) => void;
}

const WindowManagerContext =
  React.createContext<WindowManagerContextType | null>(null);

export function WindowManager({ children }: WindowManagerProps) {
  const { t } = useTranslation();
  const tabScope = useId();
  const [showBrowser, setShowBrowser] = useState(false);
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const nextZIndex = useRef(1000);
  const windowCounter = useRef(0);

  const openWindow = useCallback(
    (windowData: Omit<WindowInstance, "id" | "zIndex">) => {
      setShowBrowser(false);
      const id = `window-${++windowCounter.current}`;
      const zIndex = ++nextZIndex.current;

      const offset = (windows.length % 5) * 20;
      let adjustedX = windowData.x + offset;
      let adjustedY = windowData.y + offset;

      const maxX = Math.max(0, window.innerWidth - windowData.width - 20);
      const maxY = Math.max(0, window.innerHeight - windowData.height - 20);

      adjustedX = Math.max(20, Math.min(adjustedX, maxX));
      adjustedY = Math.max(20, Math.min(adjustedY, maxY));

      const newWindow: WindowInstance = {
        ...windowData,
        id,
        zIndex,
        x: adjustedX,
        y: adjustedY,
      };

      setWindows((prev) => [...prev, newWindow]);
      return id;
    },
    [windows.length],
  );

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, isMinimized: !w.isMinimized } : w,
      ),
    );
  }, []);

  const maximizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, isMaximized: !w.isMaximized } : w,
      ),
    );
  }, []);

  const focusWindow = useCallback((id: string) => {
    setShowBrowser(false);
    setWindows((prev) => {
      const targetWindow = prev.find((w) => w.id === id);
      if (!targetWindow) return prev;

      const newZIndex = ++nextZIndex.current;
      return prev.map((w) => (w.id === id ? { ...w, zIndex: newZIndex } : w));
    });
  }, []);

  const updateWindow = useCallback(
    (id: string, updates: Partial<WindowInstance>) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      );
    },
    [],
  );

  const contextValue: WindowManagerContextType = {
    windows,
    openWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    focusWindow,
    updateWindow,
  };

  const activeWindow = showBrowser
    ? undefined
    : windows
        .filter((window) => !window.isMinimized)
        .reduce<WindowInstance | undefined>(
          (active, window) =>
            !active || window.zIndex > active.zIndex ? window : active,
          undefined,
        );
  const activate = (window: WindowInstance) => {
    if (window.isMinimized) minimizeWindow(window.id);
    focusWindow(window.id);
  };

  return (
    <WindowManagerContext.Provider value={contextValue}>
      <div
        className="h-full min-h-0"
        style={{ paddingTop: windows.length ? 36 : 0 }}
      >
        {children}
      </div>
      <div
        className="window-container absolute inset-0 pointer-events-none overflow-hidden flex flex-col"
        style={{ zIndex: 1000 }}
      >
        {windows.length > 0 && (
          <div
            role="tablist"
            aria-label={t("fileManager.editorTabs")}
            className="pointer-events-auto flex h-9 shrink-0 overflow-x-auto border-b border-border bg-background"
          >
            <button
              type="button"
              className="shrink-0 px-3 text-xs border-r border-border"
              onClick={() => setShowBrowser(true)}
            >
              {t("fileManager.backToFileList")}
            </button>
            {windows.map((window, index) => (
              <button
                key={window.id}
                id={`${tabScope}-editor-tab-${window.id}`}
                role="tab"
                aria-selected={activeWindow?.id === window.id}
                aria-controls={`${tabScope}-editor-panel-${window.id}`}
                tabIndex={activeWindow?.id === window.id ? 0 : -1}
                className={`shrink-0 px-3 py-2 text-xs border-r border-border ${activeWindow?.id === window.id ? "text-primary bg-muted" : "text-muted-foreground"}`}
                onClick={() => activate(window)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % windows.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + windows.length) % windows.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? windows.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  activate(windows[next]);
                  document
                    .getElementById(
                      `${tabScope}-editor-tab-${windows[next].id}`,
                    )
                    ?.focus();
                }}
              >
                {window.title}
              </button>
            ))}
          </div>
        )}
        <div className="relative flex-1 min-h-0 w-full pointer-events-none">
          {windows.map((window) => (
            <div
              key={window.id}
              id={`${tabScope}-editor-panel-${window.id}`}
              role="tabpanel"
              aria-labelledby={`${tabScope}-editor-tab-${window.id}`}
              className="pointer-events-auto"
              style={{
                display: activeWindow?.id === window.id ? undefined : "none",
              }}
            >
              {typeof window.component === "function"
                ? window.component(window.id)
                : window.component}
            </div>
          ))}
        </div>
      </div>
    </WindowManagerContext.Provider>
  );
}

export function useWindowManager() {
  const context = React.useContext(WindowManagerContext);
  if (!context) {
    throw new Error("useWindowManager must be used within a WindowManager");
  }
  return context;
}
