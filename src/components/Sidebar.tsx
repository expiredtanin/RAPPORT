// Seitenleiste: Logo (ein-/ausklappbar), Navigation mit Unterpunkten, Vor/Zurück,
// «Über Rapport»/Version, Benutzer mit Dark-Mode- und Logout-Knopf.
// Hält selbst keinen State — Navigation, Klappzustand und Theme gehören App.tsx und
// kommen als Props. Sichtbare Einträge (`items`) sind bereits nach Rolle gefiltert.
// Farben sind absichtlich fest: die Leiste ist in Light und Dark Mode dunkel.

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
}

export default function Sidebar({
  data, items, view, collapsed, navOpen, setNavOpen, setSidebarCollapsed, expandedNav, setExpandedNav,
  navigate, setSelectedProjectId, goBack, goForward, navCanBack, navCanForward, onShowAbout,
  onShowChangelog, currentUser, currentUserRecord, userInitials, darkMode, setDarkMode, handleLogout,
}: SidebarProps) {
  return (
    <div className={`sidebar${navOpen ? " open" : ""}`} style={{ width: collapsed ? 56 : 210, background: "#1a1a18", display: "flex", flexDirection: "column", padding: "33px 0", alignSelf: "stretch", margin: "15px 15px 15px 0", flexShrink: 0, borderRadius: "0 16px 16px 0", border: "1px solid #3a3a34", boxShadow: "6px 0 20px rgba(0,0,0,0.18), 0 6px 16px rgba(0,0,0,0.12), 0 -6px 16px rgba(0,0,0,0.12)", clipPath: "inset(-14px -100px -14px 0)", transition: "width 0.2s ease", overflow: "hidden" }}>
      <div style={{ padding: collapsed ? "0 0 28px" : "0 22px 28px", borderBottom: "1px solid #2d2d28", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", transition: "padding 0.2s", flexShrink: 0 }}>
        {collapsed ? (
          <button className="sidebar-logo-btn" onClick={() => setSidebarCollapsed(false)} title="Sidebar ausklappen">
            <div className="sidebar-logo-text" style={{ fontFamily: "Krungthep, 'Archivo Black', sans-serif", fontSize: 22, color: "#f0ede8", lineHeight: 1, letterSpacing: "-0.02em" }}>R</div>
          </button>
        ) : (
          <>
            <button className="sidebar-logo-btn" onClick={() => setSidebarCollapsed(true)} title="Sidebar einklappen">
              <div className="sidebar-logo-text">
                <div style={{ fontFamily: "Krungthep, 'Archivo Black', sans-serif", fontSize: 28, color: "#f0ede8", lineHeight: 0.95, letterSpacing: "-0.02em" }}>RAPPORT</div>
                <div style={{ fontSize: 9, color: "#4a4840", marginTop: 8, letterSpacing: "0.15em", fontWeight: 500 }}>{(data.settings.name || "STUDIO ADMINISTRATION").toUpperCase()}</div>
              </div>
            </button>
            <button onClick={() => setNavOpen(false)} style={{ background: "none", border: "none", color: "#555", fontSize: 20, padding: 0, lineHeight: 1, display: "none" }} className="mobile-close"><span className="msr" style={{fontSize:16,verticalAlign:"middle"}}>close</span></button>
          </>
        )}
      </div>
      <nav style={{ flex: 1, padding: "18px 0", overflowY: "auto", minHeight: 0 }}>
        {items.map(item => {
          const isParentActive = view === item.id || (item.children || []).some(c => c.id === view);
          const isExpanded = expandedNav.has(item.id);
          const toggleExpand = (e: MouseEvent) => {
            e.stopPropagation();
            setExpandedNav(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            });
          };
          if (item.children) {
            if (collapsed) {
              return (
                <button key={item.id} title={item.label} onClick={() => { navigate(item.id); setNavOpen(false); }} style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "100%", padding: "11px 0",
                  background: isParentActive ? "#252520" : "transparent",
                  border: "none", cursor: "pointer",
                  color: isParentActive ? "#e8e5df" : "#888", transition: "all 0.15s",
                }}><span className="msr" style={{ fontSize: 22 }}>{item.icon}</span></button>
              );
            }
            return (
              <div key={item.id} style={{ padding: "2px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", borderRadius: 28, background: isParentActive ? "#2e2e28" : "transparent", transition: "background 0.15s" }}>
                  <button className="nav-btn" onClick={() => { navigate(item.id); setNavOpen(false); setExpandedNav(prev => { const next = new Set(prev); next.add(item.id); return next; }); }} style={{
                    flex: 1, padding: "10px 0 10px 14px",
                    background: "transparent", border: "none",
                    color: isParentActive ? "#e8e5df" : "#aaa",
                    display: "flex", alignItems: "center", gap: 10,
                    fontSize: 11, textAlign: "left", fontFamily: "inherit", cursor: "pointer",
                    letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, borderRadius: "28px 0 0 28px",
                  }}>
                    <span className="msr" style={{ fontSize: 18, flexShrink: 0, opacity: isParentActive ? 1 : 0.6 }}>{item.icon}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                  </button>
                  <button className="nav-btn" onClick={toggleExpand} style={{
                    flexShrink: 0, width: 36, alignSelf: "stretch",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: isExpanded ? "#bbb" : "#555", fontSize: 8,
                    fontFamily: "inherit", padding: 0, borderRadius: "0 28px 28px 0",
                  }}>
                    <span style={{ display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▶</span>
                  </button>
                </div>
                {isExpanded && (
                  <div style={{ paddingTop: 2, paddingBottom: 4 }}>
                    {item.children.map(child => (
                      <button key={child.id} className="nav-btn" onClick={() => { navigate(child.id); setNavOpen(false); }} style={{
                        display: "block", width: "100%", padding: "7px 14px 7px 42px",
                        background: view === child.id ? "#222220" : "transparent",
                        color: view === child.id ? "#d8d5cf" : "#777",
                        fontSize: 10, textAlign: "left", fontFamily: "inherit", cursor: "pointer",
                        border: "none", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500,
                        borderRadius: 20,
                      }}>{child.label}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (collapsed) {
            return (
              <button key={item.id} title={item.label} className="nav-btn" onClick={() => { navigate(item.id); setSelectedProjectId(null); setNavOpen(false); }} style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "100%", padding: "11px 0",
                background: view === item.id ? "#2e2e28" : "transparent",
                border: "none", cursor: "pointer",
                color: view === item.id ? "#e8e5df" : "#888",
              }}><span className="msr" style={{ fontSize: 22 }}>{item.icon}</span></button>
            );
          }
          return (
            <button key={item.id} className="nav-btn nav-pill" onClick={() => { navigate(item.id); setSelectedProjectId(null); setNavOpen(false); }} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px",
              background: view === item.id ? "#2e2e28" : "transparent",
              color: view === item.id ? "#e8e5df" : "#aaa",
              border: "none", fontFamily: "inherit", cursor: "pointer",
              letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, fontSize: 11,
            }}>
              <span className="msr" style={{ fontSize: 18, flexShrink: 0, opacity: view === item.id ? 1 : 0.6 }}>{item.icon}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
            </button>
          );
        })}
      </nav>
      {/* ── Vor / Zurück ── */}
      <div style={{ borderTop: "1px solid #2d2d28", display: "flex", gap: 2, padding: collapsed ? "8px 0" : "6px 10px", justifyContent: collapsed ? "center" : "flex-start", flexShrink: 0 }}>
        {([["goBack", "‹", goBack, navCanBack, "Zurück"], ["goForward", "›", goForward, navCanForward, "Vorwärts"]] as [string, string, () => void, boolean, string][]).map(([key, ch, fn, enabled, title]) => (
          <button key={key} onClick={enabled ? fn : undefined} title={title} style={{ background: "none", border: "none", color: enabled ? "#888" : "#333", cursor: enabled ? "pointer" : "default", fontSize: 20, lineHeight: 1, padding: "4px 9px", fontFamily: "inherit", borderRadius: 6, transition: "color 0.15s" }}
            onMouseEnter={e => { if (enabled) e.currentTarget.style.color = "#ccc"; }}
            onMouseLeave={e => { e.currentTarget.style.color = enabled ? "#888" : "#333"; }}>
            {ch}
          </button>
        ))}
      </div>

      {!collapsed && <div style={{ padding: "8px 16px", borderTop: "1px solid #2d2d28", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => onShowAbout()} style={{ background: "none", border: "none", padding: 0, color: "#888", fontSize: 10, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.color = "#aaa"} onMouseLeave={e => e.currentTarget.style.color = "#888"}>ÜBER RAPPORT</button>
          <button onClick={() => onShowChangelog(LATEST_VERSION)} style={{ background: "none", border: "none", padding: 0, color: "#aaa", fontSize: 10, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit" }}
            onMouseEnter={e => e.currentTarget.style.color = "#f0ede8"} onMouseLeave={e => e.currentTarget.style.color = "#aaa"}>{versionLabel(LATEST_VERSION)}</button>
        </div>
      </div>}

      {/* Benutzer + Logout + Theme */}
      <div style={{ padding: collapsed ? "10px 0" : "10px 16px", borderTop: "1px solid #2d2d28", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", gap: 8, flexShrink: 0 }}>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#2e2e28", border: "1.5px solid #3a3a30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: "#9a9690", flexShrink: 0, overflow: "hidden", letterSpacing: "0.02em" }}>
              {currentUserRecord?.avatar
                ? <img src={currentUserRecord.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : userInitials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "#aaa", fontWeight: 500, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {currentUser.displayName || currentUser.username}
              </div>
              {currentUser.role === "admin" && <div style={{ fontSize: 9, color: "#888", letterSpacing: "0.1em" }}>ADMIN</div>}
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button onClick={() => setDarkMode(d => !d)} title={darkMode ? "Light Mode" : "Dark Mode"} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, transition: "color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.color = "#ccc"}
            onMouseLeave={e => e.currentTarget.style.color = "#888"}>
            <span className="msr" style={{ fontSize: 18 }}>{darkMode ? "light_mode" : "dark_mode"}</span>
          </button>
          <button onClick={handleLogout} title="Abmelden" style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, transition: "color 0.15s", flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = "#b5621e"}
            onMouseLeave={e => e.currentTarget.style.color = "#888"}>
            <span className="msr" style={{ fontSize: 18 }}>logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}
