// Seitenleiste: Logo (ein-/ausklappbar), Navigation mit Unterpunkten, Vor/Zurück,
// «Über Rapport»/Version, Benutzer mit Dark-Mode- und Logout-Knopf.
// Hält selbst keinen State — Navigation, Klappzustand und Theme gehören App.tsx und
// kommen als Props. Sichtbare Einträge (`items`) sind bereits nach Rolle gefiltert.
// Die Leiste ist in Light und Dark Mode dunkel; Farben über die Variablen `--side-*` und die
// Klassen `.side-*` in global.css (Hover und Fokus in CSS, damit sie auch mit der Tastatur sichtbar sind).
// Unterpunkte sind beim aktiven Bereich immer offen, andere lassen sich aufklappen (schliessen beim Navigieren).

import type { Dispatch, MouseEvent, SetStateAction } from "react";
import type { NavItem } from "../constants";
import { LATEST_VERSION, versionLabel } from "../changelog";
import type { AppData, CurrentUser, User } from "../types";

export interface SidebarProps {
  data: AppData;
  items: NavItem[];
  view: string;
  /** Eingeklappte Desktop-Leiste (nur Icons). Auf dem Handy nie eingeklappt. */
  collapsed: boolean;
  /** Mobile: Leiste als Overlay geöffnet. */
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  expandedNav: Set<string>;
  setExpandedNav: Dispatch<SetStateAction<Set<string>>>;
  navigate: (view: string) => void;
  setSelectedProjectId: (id: string | null) => void;
  goBack: () => void;
  goForward: () => void;
  navCanBack: boolean;
  navCanForward: boolean;
  onShowAbout: () => void;
  onShowChangelog: (version: string) => void;
  currentUser: CurrentUser;
  currentUserRecord: User | undefined;
  userInitials: string;
  darkMode: boolean;
  setDarkMode: Dispatch<SetStateAction<boolean>>;
  handleLogout: () => void;
  /** Befehlspalette öffnen (⌘K) */
  onOpenPalette: () => void;
}

export default function Sidebar({
  data, items, view, collapsed, navOpen, setNavOpen, setSidebarCollapsed, expandedNav, setExpandedNav,
  navigate, setSelectedProjectId, goBack, goForward, navCanBack, navCanForward, onShowAbout,
  onShowChangelog, currentUser, currentUserRecord, userInitials, darkMode, setDarkMode, handleLogout, onOpenPalette,
}: SidebarProps) {
  // Von Hand aufgeklappte Bereiche schliessen beim Navigieren wieder; der aktive Bereich ist immer offen.
  const go = (id: string) => { navigate(id); setSelectedProjectId(null); setNavOpen(false); setExpandedNav(new Set()); };
  return (
    <aside className={`sidebar${navOpen ? " open" : ""}${collapsed ? " collapsed" : ""}`} style={{ width: collapsed ? 60 : 220 }}>
      <div className="side-head">
        {collapsed ? (
          <button className="sidebar-logo-btn side-wordmark" onClick={() => setSidebarCollapsed(false)} title="Seitenleiste ausklappen" aria-label="Seitenleiste ausklappen">R</button>
        ) : (
          <>
            <button className="sidebar-logo-btn" onClick={() => setSidebarCollapsed(true)} title="Seitenleiste einklappen" aria-label="Seitenleiste einklappen">
              <div className="side-wordmark">RAPPORT</div>
              <div className="side-studio">{data.settings.name || "Studio"}</div>
            </button>
            <button onClick={() => setNavOpen(false)} className="mobile-close side-icon-btn" aria-label="Menü schliessen"><span className="msr" style={{ fontSize: 20 }}>close</span></button>
          </>
        )}
      </div>
      <button className="side-search" onClick={() => { setNavOpen(false); onOpenPalette(); }} title="Suchen und Befehle (⌘K)">
        <span className="msr" style={{ fontSize: 17 }}>search</span>{!collapsed && <><span>Suchen …</span><kbd>⌘K</kbd></>}
      </button>
      <nav className="side-nav" aria-label="Hauptnavigation">
        {items.map((item, idx) => {
          const prevGroup = idx > 0 ? items[idx - 1].group : undefined;
          const groupHead = item.group !== undefined && item.group !== prevGroup
            ? (item.group ? <div className="side-group">{item.group}</div> : <div className="side-sep" />) : null;
          const isParentActive = view === item.id || (item.children || []).some(c => c.id === view);
          const isExpanded = !collapsed && (expandedNav.has(item.id) || isParentActive);
          const toggleExpand = (e: MouseEvent) => {
            e.stopPropagation();
            setExpandedNav(prev => {
              const next = new Set(prev);
              if (isExpanded) next.delete(item.id); else next.add(item.id);
              return next;
            });
          };
          return (
            <div key={item.id}>
              {groupHead}
              <div className={`side-item${isParentActive ? " active" : ""}`}>
                <button className="side-link" onClick={() => go(item.id)} title={collapsed ? item.label : undefined} aria-current={view === item.id ? "page" : undefined}>
                  <span className="msr side-ico">{item.icon}</span>
                  {!collapsed && <span className="side-label">{item.label}</span>}
                </button>
                {item.children && !collapsed && !isParentActive && (
                  <button className="side-toggle" onClick={toggleExpand} aria-label={isExpanded ? `${item.label} zuklappen` : `${item.label} aufklappen`} aria-expanded={isExpanded}>
                    <span className="msr" style={{ fontSize: 18, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>expand_more</span>
                  </button>
                )}
              </div>
              {item.children && isExpanded && (
                <div className="side-children">
                  {item.children.map(child => (
                    <button key={child.id} className={`side-child${view === child.id ? " active" : ""}`} onClick={() => go(child.id)} aria-current={view === child.id ? "page" : undefined}>{child.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="side-foot">
        <div className="side-history" style={{ justifyContent: collapsed ? "center" : "flex-start" }}>
          <button className="side-icon-btn" onClick={goBack} disabled={!navCanBack} title="Zurück (⌘[)" aria-label="Zurück"><span className="msr">chevron_left</span></button>
          <button className="side-icon-btn" onClick={goForward} disabled={!navCanForward} title="Vorwärts (⌘])" aria-label="Vorwärts"><span className="msr">chevron_right</span></button>
          {!collapsed && <span style={{ flex: 1 }} />}
          {!collapsed && <button className="side-meta" onClick={() => onShowChangelog(LATEST_VERSION)} title="Neuerungen">{versionLabel(LATEST_VERSION)}</button>}
        </div>
        <div className="side-user" style={{ justifyContent: collapsed ? "center" : "space-between", flexDirection: collapsed ? "column" : "row" }}>
          {!collapsed && (
            <button className="side-user-btn" onClick={() => onShowAbout()} title="Über RAPPORT">
              <span className="side-avatar">
                {currentUserRecord?.avatar
                  ? <img src={currentUserRecord.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : userInitials}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="side-user-name">{currentUser.displayName || currentUser.username}</span>
                <span className="side-user-role">{currentUser.role === "admin" ? "Admin" : "Über RAPPORT"}</span>
              </span>
            </button>
          )}
          <span style={{ display: "flex", gap: 2, flexDirection: collapsed ? "column" : "row" }}>
            <button className="side-icon-btn" onClick={() => setDarkMode(d => !d)} title={darkMode ? "Heller Modus" : "Dunkler Modus"} aria-label={darkMode ? "Heller Modus" : "Dunkler Modus"}>
              <span className="msr" style={{ fontSize: 18 }}>{darkMode ? "light_mode" : "dark_mode"}</span>
            </button>
            <button className="side-icon-btn side-logout" onClick={handleLogout} title="Abmelden" aria-label="Abmelden">
              <span className="msr" style={{ fontSize: 18 }}>logout</span>
            </button>
          </span>
        </div>
      </div>
    </aside>
  );
}
