// Erscheinungsbild-Einstellungen, die pro Gerät im localStorage liegen (nicht in `data`):
// Dark Mode (`rapport_dark`), eingeklappte Seitenleiste (`rapport_sidebar_collapsed`) und
// UI-Zoom (`rapport_zoom`, nur Hauptbereich — die Seitenleiste bleibt unverzerrt).
// Der Zoom wird in den Einstellungen gesetzt (`setUiZoom`).

import { useEffect, useState } from "react";

export function useAppearance() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("rapport_dark") === "1");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("rapport_sidebar_collapsed") === "1");
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  /** Auf dem Handy nie eingeklappt: dort ist die Leiste ein Overlay. */
  const collapsed = sidebarCollapsed && !isMobile;
  const [uiZoom, setUiZoom] = useState(() => parseFloat(localStorage.getItem("rapport_zoom") || "1"));

  useEffect(() => { localStorage.setItem("rapport_dark", darkMode ? "1" : "0"); }, [darkMode]);
  useEffect(() => { localStorage.setItem("rapport_sidebar_collapsed", sidebarCollapsed ? "1" : "0"); }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem("rapport_zoom", String(uiZoom));
    // Tauri: native WebView-Zoom entfernen falls gesetzt (Sidebar-Problem)
    if (window.__TAURI_INTERNALS__) {
      import("@tauri-apps/api/webviewWindow")
        .then(({ getCurrentWebviewWindow }) => getCurrentWebviewWindow().setZoom(1))
        .catch(() => {});
    }
  }, [uiZoom]);

  return { darkMode, setDarkMode, sidebarCollapsed, setSidebarCollapsed, isMobile, collapsed, uiZoom, setUiZoom };
}
