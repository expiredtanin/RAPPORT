// Wurzel der App: hält den GESAMTEN State (`data`), die Anmeldung, die Navigation
// und die Layout-Hülle (Seitenleiste, Kopfzeile, Modals). Views bekommen `data` und
// die Schreibfunktionen als Props (`ViewProps` in types.ts) — es gibt keinen Context
// und kein Redux; was mehrere Views brauchen, wird hier gehalten.
//
// Der Daten-State selbst (Laden, `save`/`update`, Realtime) liegt in hooks/useStudioData.ts.
// Persistenz: `update(key, value)` setzt ein Top-Level-Feld, `save(newData)` ersetzt den
// ganzen Stand; beide setzen den React-State sofort («optimistisch») und rufen
// `storage.save()` auf (localStorage bzw. PocketBase, siehe storage/adapter.ts). Beim Start
// wird `storage.load()` gelesen und durch `applyMigrations` auf das aktuelle Schema gebracht.
//
// Bildschirm-Reihenfolge (früh zurückkehrende Zweige weiter unten): Laden → Passwort-
// Reset → Backend-Wahl (Erststart) → Setup/CloudSetup/MigrationScreen → Login → Hauptansicht.
// Cloud: Session (sessionStorage `rapport_user`, `rapport_studio_id`) wird beim Neuladen
// wiederhergestellt; Änderungen anderer Nutzer kommen über Realtime (`subscribeToChanges`)
// als gezielte Teil-Reloads (`loadPartial`). Rollen: `userPermissions` (null = alles) wird
// aus der App-Rolle des Nutzers abgeleitet und bestimmt Navigation und Zugriff.
// Neue Ansicht: lazy importieren (unten), in NAV_ITEMS (constants.ts) eintragen und im
// Render-Block mit `hasViewAccess` einbinden. Versions-Changelog: `CHANGELOGS` + `LATEST_VERSION` in changelog.ts.

import React, { useState, useEffect, Suspense, lazy } from "react";
import { NAV_ITEMS, defaultData, statusCssVars } from "./constants";
import { verifyPassword, withHashedPassword, stripCredentials } from "./utils";
import { storage, cloudStorage, isCloudBackend, isServerMode } from "./storage/adapter";
import { pickAndActivateDataFolder } from "./storage/data-folder";
import { applyMigrations } from "./storage/migrations";
import type { AppData, CurrentUser, ModalState, PrintContent, User } from "./types";
import Login from "./views/Login";
import Setup from "./views/Setup";
import BackendChoice from "./views/BackendChoice";
import CloudSetup from "./views/CloudSetup";
import ResetPassword from "./views/ResetPassword";
import MigrationScreen from "./views/MigrationScreen";
import UpdateNotifier from "./components/UpdateNotifier";
import DataFolderHint from "./components/DataFolderHint";
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";
import { useNavigation } from "./hooks/useNavigation";
import { useStudioData } from "./hooks/useStudioData";
import { useAppearance } from "./hooks/useAppearance";
import { getUserPermissions, getUserInitials, getVisibleNavItems } from "./auth";
import { ChangelogModal, AboutModal } from "./components/InfoModals";
import { LATEST_VERSION, versionLabel } from "./changelog";

// Code-split: each view loads on demand to keep the initial bundle small.
const Dashboard      = lazy(() => import("./views/Dashboard"));
const Projects       = lazy(() => import("./views/Projects"));
const ProjectDetail  = lazy(() => import("./views/ProjectDetail"));
const Time           = lazy(() => import("./views/Time"));
const Expenses       = lazy(() => import("./views/Expenses"));
const InternalExpenses = lazy(() => import("./views/InternalExpenses"));
const Protocols      = lazy(() => import("./views/Protocols"));
const DeliveryNotes  = lazy(() => import("./views/DeliveryNotes"));
const Accounting     = lazy(() => import("./views/Accounting"));
const Invoices       = lazy(() => import("./views/Invoices"));
const Quotes         = lazy(() => import("./views/Quotes"));
const Crm            = lazy(() => import("./views/Crm"));
const Contracts      = lazy(() => import("./views/Contracts"));
const Persons        = lazy(() => import("./views/Persons"));
const Letters        = lazy(() => import("./views/Letters"));
const Settings       = lazy(() => import("./views/Settings"));
const DataImport     = lazy(() => import("./views/DataImport"));
const StudioBudget   = lazy(() => import("./views/StudioBudget"));
const Payroll        = lazy(() => import("./views/Payroll"));
const Employees      = lazy(() => import("./views/Employees"));
const Pinboard       = lazy(() => import("./views/Pinboard"));
const Documents      = lazy(() => import("./views/Documents"));
const PrintView      = lazy(() => import("./print/PrintComponents").then(m => ({ default: m.PrintView })));

function ViewFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "calc(100vh - 60px)" }}>
      <style>{`
        @keyframes vf-spin { to { transform: rotate(360deg); } }
        .vf-spinner {
          width: 40px; height: 40px; border-radius: 50%;
          border: 2px solid rgba(0,0,0,0.08);
          border-top-color: rgba(0,0,0,0.45);
          animation: vf-spin 0.9s linear infinite;
        }
      `}</style>
      <div className="vf-spinner" />
    </div>
  );
}

export default function App() {
  // Angemeldeter Nutzer (Session); steht vor dem Daten-Hook, weil dessen Realtime-Abgleich ihn braucht.
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    try { return JSON.parse(sessionStorage.getItem("rapport_user") || "null") || null; } catch { return null; }
  });
  const {
    data, setData, loading, loadError, saveError, isNewInstall, cloudStudios, cloudUnreachable,
    passwordRecovery, setPasswordRecovery, resetToken, setResetToken, save, update,
    dataNotices, dismissDataNotices,
  } = useStudioData(currentUser);
  const handleLogin = (user: User | CurrentUser) => {
    const safe = stripCredentials(user);
    sessionStorage.setItem("rapport_user", JSON.stringify(safe));
    setCurrentUser(safe as CurrentUser);
  };
  // Used by the Login screen — never exposes the user list (with passwords) to the view.
  // Routes by backend: cloud → Supabase Auth, local → PBKDF2 gegen data.users.
  const verifyLogin = async (usernameOrEmail: string, password: string, opts: { studioId?: string | null } = {}) => {
    if (isCloudBackend) return cloudSignIn(usernameOrEmail, password, opts.studioId ?? null);

    const u = (data.users || []).find(x => x.username === usernameOrEmail);
    if (!u) return null;
    const ok = await verifyPassword(password, u);
    if (!ok) return null;
    if (u.password && !u.passwordHash) {
      try {
        const upgraded = await withHashedPassword(u, password);
        save({ ...data, users: (data.users || []).map(x => x.id === u.id ? upgraded : x) });
        handleLogin(upgraded);
        return upgraded;
      } catch (e) {
        console.error("Passwort-Migration fehlgeschlagen:", e);
      }
    }
    handleLogin(u);
    return u;
  };

  // Cloud-Erst-Einrichtung: einmaliger Bootstrap-Pfad, wenn die Cloud-Instanz
  // noch leer ist (0 Studios). Im laufenden Betrieb gibt es keinen Self-Signup
  // — Mitarbeiter werden via Admin-Aktion eingeladen.
  // `extraSettings` enthält optionale Stammdaten (Adresse, IBAN, MwSt, …),
  // die nach createStudio in die studio_settings geschrieben werden.
  const cloudInit = async (email: string, password: string, displayName: string, studioName: string, extraSettings: Partial<AppData["settings"]> = {}) => {
    try {
      const signUpRes = await cloudStorage.signUp(email, password);
      if (!signUpRes.ok) return { ok: false, error: signUpRes.error };

      const username = (email.split("@")[0] || "user").replace(/[^a-zA-Z0-9._-]/g, "");
      await cloudStorage.ensureProfile(username, displayName);

      const baseSlug = studioName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const slug = `${baseSlug || "studio"}-${Date.now().toString(36)}`;
      const studioId = await cloudStorage.createStudio(studioName, slug);

      cloudStorage.setStudioId(studioId);
      sessionStorage.setItem("rapport_studio_id", studioId);

      const parsed = await cloudStorage.load();
      let merged = applyMigrations(parsed, defaultData);

      // Optionale Stammdaten anwenden + sofort speichern, damit sie persistiert
      // sind, bevor der User irgendwo durchklickt (sonst geht beim nächsten
      // Reload Adresse/IBAN verloren).
      if (Object.keys(extraSettings).length > 0) {
        merged = { ...merged, settings: { ...merged.settings, ...extraSettings } };
        await storage.save(merged);
      }
      setData(merged);

      handleLogin({
        id: signUpRes.user!.id,
        username,
        displayName,
        role: "admin",
        appRoleId: "r-admin",
      });
      return { ok: true };
    } catch (e) {
      console.error("Cloud init fehlgeschlagen:", e);
      return { ok: false, error: (e as Error)?.message || "Unbekannter Fehler" };
    }
  };

  // Cloud-Login: signIn → Studio wählen (Dropdown im Login oder erstes) → data laden.
  // `preferredStudioId` kommt aus dem Login-Dropdown wenn Multi-Studio-Instanz.
  const cloudSignIn = async (email: string, password: string, preferredStudioId: string | null = null) => {
    try {
      const result = await cloudStorage.signIn(email, password);
      if (!result) return null;
      if (result.studios.length === 0) {
        console.warn("Cloud-Login OK, aber User ist in keinem Studio Mitglied.");
        return null;
      }
      // Wenn ein Studio vorgewählt wurde, prüfen ob der User dort Member ist
      const membership = preferredStudioId
        ? result.studios.find(m => m.studio_id === preferredStudioId)
        : result.studios[0];
      if (!membership) {
        console.warn("User ist im gewählten Studio nicht Mitglied.");
        return null;
      }
      cloudStorage.setStudioId(membership.studio_id);
      sessionStorage.setItem("rapport_studio_id", membership.studio_id);
      const parsed = await cloudStorage.load();
      setData(applyMigrations(parsed, defaultData));
      // Verknüpfung Mitarbeiter↔Cloud-User existiert nur umgekehrt über
      // employees.appUserId — ohne diese Auflösung bleibt currentUser.employeeId
      // leer und Self-Service-Ansichten (Time.jsx isAdmin-Fallback, Dashboard-
      // Widgets) behandeln jeden eingeloggten Nutzer wie einen Admin.
      const linkedEmployee = (parsed.employees || []).find(e => e.appUserId === result.user.id);
      const user: CurrentUser = {
        id: result.user.id,
        username: result.profile?.username || result.user.email,
        displayName: result.profile?.display_name || result.user.email,
        role: membership.app_role_id === "r-admin" ? "admin" : "user",
        appRoleId: membership.app_role_id,
        employeeId: linkedEmployee?.id || null,
      };
      handleLogin(user);
      return user;
    } catch (e) {
      console.error("Cloud signIn fehlgeschlagen:", e);
      return null;
    }
  };
  const handleLogout = () => {
    sessionStorage.removeItem("rapport_user");
    sessionStorage.removeItem("rapport_studio_id");
    if (isCloudBackend) {
      cloudStorage.signOut?.().catch(() => {});
    }
    setCurrentUser(null);
  };
  const handleSetupComplete = (newData: AppData) => {
    localStorage.setItem("rapport_v0_5_migrated", "1");
    save(newData);
    const adminUser = (newData.users || []).find(u => u.role === "admin");
    if (adminUser) handleLogin(adminUser);
  };
  const userPermissions = getUserPermissions(currentUser, data);
  const currentUserRecord = (data.users || []).find(u => u.id === currentUser?.id);
  const userInitials = getUserInitials(currentUser);
  const visibleNavItems = getVisibleNavItems(userPermissions);
  const initialView = !userPermissions ? "dashboard" : (userPermissions.includes("dashboard") ? "dashboard" : (userPermissions[0] || "dashboard"));
  const allAccessibleViews = visibleNavItems.flatMap(item => item.children ? item.children.map(c => c.id) : [item.id]);
  const { view, navigate, goBack, goForward, navCanBack, navCanForward } = useNavigation(initialView);
  const hasViewAccess = userPermissions === null || allAccessibleViews.includes(view);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [printContent, setPrintContent] = useState<PrintContent>(null);
  const [showChangelog, setShowChangelog] = useState(() => localStorage.getItem("rapport_changelog_seen") !== LATEST_VERSION);
  const [changelogVersion, setChangelogVersion] = useState(LATEST_VERSION);
  const [showAbout, setShowAbout] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [expandedNav, setExpandedNav] = useState(new Set(["buchhaltung"]));
  const { darkMode, setDarkMode, setSidebarCollapsed, collapsed, uiZoom, setUiZoom } = useAppearance();

  // Navigation zu Protokoll von Projekt aus
  useEffect(() => {
    const handler = (e: Event) => {
      navigate("protokolle");
      window.__openProtokoll = (e as CustomEvent).detail?.id || null;
    };
    window.addEventListener("openProtokoll", handler);
    return () => window.removeEventListener("openProtokoll", handler);
  }, [navigate]);

  // Tray-Menü: „Zeiterfassung", „Projekte" usw. springen zur passenden View
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    // `cancelled`: wird der Effekt abgebaut, bevor listen() fertig ist, den Listener sofort wieder lösen
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("rapport:navigate", (event) => {
        const target = event.payload;
        if (typeof target === "string") {
          navigate(target);
          setSelectedProjectId(null);
        }
      }).then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    });
    return () => { cancelled = true; if (unlisten) unlisten(); };
  }, [navigate]);

  // Auto-expand parent when navigating to a child
  useEffect(() => {
    NAV_ITEMS.forEach(item => {
      if (item.children?.some(c => c.id === view)) {
        setExpandedNav(prev => { const next = new Set(prev); next.add(item.id); return next; });
      }
    });
  }, [view]);

  // Boot-Spinner während Initial-Load (Adapter ist async, auch wenn LocalStorage <50ms)
  if (loading) return <ViewFallback />;

  // Datenordner nicht lesbar (nicht synchronisiert, Datei beschädigt): nie mit leeren Daten starten,
  // sonst würde das nächste Speichern die echten Dateien überschreiben.
  if (loadError) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 24 }}>
        <div className="card" style={{ maxWidth: 480, padding: "28px 30px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Datenordner nicht lesbar</div>
          <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7, marginBottom: 6 }}>{loadError}</div>
          <div style={{ fontSize: 11, color: "var(--text5)", fontFamily: "monospace", marginBottom: 20, wordBreak: "break-all" }}>{localStorage.getItem("rapport_data_dir")}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Erneut versuchen</button>
            <button className="btn btn-ghost" onClick={pickAndActivateDataFolder}>Anderen Ordner wählen</button>
          </div>
        </div>
      </div>
    );
  }

  // Erst-Screen einer frischen Installation: «Lokal oder Cloud?».
  // Sichtbar solange der User die Wahl noch nicht getroffen hat UND es keine
  // lokalen Daten gibt. Sobald er gewählt hat, übernimmt der jeweilige Wizard.
  // UpdateNotifier wird in allen Pre-Login-Screens mitgerendert, damit ein
  // hängender Setup-Wizard sich via Auto-Update selbst befreien kann.
  // Server-Modus (gehostete Web-GUI): nie die Lokal/Server-Wahl zeigen — die
  // App ist fest an diesen Server gebunden. Nur die lokale DMG zeigt die Wahl.
  const hasChosenBackend = localStorage.getItem("rapport_backend_chosen") === "1";
  if (!isServerMode && !hasChosenBackend && isNewInstall && !data.settings.setupCompleted && !currentUser) {
    return <><BackendChoice /><UpdateNotifier /></>;
  }

  // Setup- und Migrations-Screens sind LocalStorage-Spezifika. Im Cloud-Modus
  // erfolgt Erst-Einrichtung über den Init-Dialog im Login.
  if (!isCloudBackend && isNewInstall && !data.settings.setupCompleted) {
    return <><Setup onComplete={handleSetupComplete} /><UpdateNotifier /></>;
  }

  if (!isCloudBackend && !localStorage.getItem("rapport_v0_5_migrated")) {
    return <><MigrationScreen data={data} onComplete={handleSetupComplete} /><UpdateNotifier /></>;
  }

  // Passwort-Reset hat höchste Priorität — User kommt von Mail-Link.
  if (passwordRecovery) {
    return <ResetPassword
      onComplete={async (newPw) => {
        return cloudStorage.confirmPasswordReset(resetToken as string, newPw);
      }}
      onCancel={() => {
        setPasswordRecovery(false);
        setResetToken(null);
        if (window.location.hash) window.location.hash = "";
      }}
    />;
  }

  // Cloud + Instanz ist leer (0 Studios) → mehrseitiger Setup-Wizard.
  // Cloud + Studios vorhanden → klassischer Login.
  // UpdateNotifier wird hier auch gerendert, damit der Auto-Update-Check auch
  // ohne Login läuft (sonst kommt man bei einem fehlerhaften Setup-Screen nie
  // an ein neueres Build, das den Bug fixt).
  if (!currentUser) {
    // Init-/Registrierungs-Screen NUR wenn der API-Call erfolgreich war UND
    // wirklich 0 Studios lieferte. Bei !cloudUnreachable ausgeschlossen, dass
    // ein Kong/API-Fehler (cloudStudios === null) hier fälschlich Init zeigt.
    if (isCloudBackend && !cloudUnreachable && cloudStudios !== null && cloudStudios.length === 0) {
      const cloudUrl = localStorage.getItem("rapport_cloud_url") || "";
      return <>
        <CloudSetup cloudInit={cloudInit} cloudUrl={cloudUrl} />
        <UpdateNotifier />
      </>;
    }
    return <>
      <Login verifyLogin={verifyLogin} settings={data.settings} version={versionLabel(LATEST_VERSION)} cloudUnreachable={cloudUnreachable} />
      <UpdateNotifier />
    </>;
  }

  if (printContent) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<ViewFallback />}>
          <PrintView content={printContent} onClose={() => setPrintContent(null)} settings={data.settings} assets={data.docAssets} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <div className="app-wrapper" data-theme={darkMode ? "dark" : "light"} style={{ display: "flex", height: "100%", overflow: "hidden", background: "var(--bg)", fontFamily: "'Inter', sans-serif", color: "var(--text)" }}>
      <style>{statusCssVars()}</style>

      {/* Mobile Header */}
      <div className="mobile-header">
        <button onClick={() => setNavOpen(o => !o)} style={{ background: "none", border: "none", color: "#aaa", fontSize: 22, padding: 0, lineHeight: 1 }}>☰</button>
        <div style={{ fontFamily: "Krungthep, 'Archivo Black', sans-serif", fontSize: 24, color: "#f0ede8", letterSpacing: "-0.02em", lineHeight: 1 }}>RAPPORT</div>
      </div>

      <DataFolderHint data={data} />

      {/* Sidebar */}
      <Sidebar
        data={data} items={visibleNavItems} view={view} collapsed={collapsed} navOpen={navOpen}
        setNavOpen={setNavOpen} setSidebarCollapsed={setSidebarCollapsed}
        expandedNav={expandedNav} setExpandedNav={setExpandedNav}
        navigate={navigate} setSelectedProjectId={setSelectedProjectId}
        goBack={goBack} goForward={goForward} navCanBack={navCanBack} navCanForward={navCanForward}
        onShowAbout={() => setShowAbout(true)}
        onShowChangelog={v => { setChangelogVersion(v); setShowChangelog(true); }}
        currentUser={currentUser} currentUserRecord={currentUserRecord} userInitials={userInitials}
        darkMode={darkMode} setDarkMode={setDarkMode} handleLogout={handleLogout}
      />

      {/* Main */}
      <div className="main-content" style={{ flex: 1, padding: "28px 24px", overflowY: "auto", minWidth: 0, background: "var(--bg)", zoom: uiZoom !== 1 ? uiZoom : undefined }}>
        {/* Bleibt stehen, bis wieder ein Speichern gelingt — sonst gingen Änderungen unbemerkt verloren */}
        {saveError && (
          <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 6, fontSize: 13,
            color: "var(--negative)", background: "var(--negative-bg)", border: "1px solid currentColor" }}>
            {saveError}
          </div>
        )}
        {/* Beim Laden reparierte Daten bzw. fehlende Anhänge: sichtbar machen statt nur in der Konsole */}
        {dataNotices.length > 0 && (
          <div role="status" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 6, fontSize: 13, lineHeight: 1.6,
            color: "var(--warning)", background: "var(--warning-bg)", border: "1px solid currentColor", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>Beim Laden ist etwas aufgefallen</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {dataNotices.slice(0, 8).map(n => <li key={n.text} style={{ wordBreak: "break-word" }}>{n.text}</li>)}
                {dataNotices.length > 8 && <li>… und {dataNotices.length - 8} weitere</li>}
              </ul>
              {dataNotices.some(n => n.kind === "repaired") && (
                <div style={{ marginTop: 4 }}>Unlesbare Teile wurden durch leere Werte ersetzt, damit Rapport weiterläuft. Bitte prüfen, ob etwas fehlt; ältere Stände liegen in den Backups.</div>
              )}
            </div>
            <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={dismissDataNotices}>Ausblenden</button>
          </div>
        )}
        {/* Absturz einer Ansicht zeigt eine Meldung statt weissem Bildschirm; Ansichtswechsel setzt zurück */}
        <ErrorBoundary resetKey={`${view}:${selectedProjectId ?? ""}`}>
        <Suspense fallback={<ViewFallback />}>
          {!hasViewAccess && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text4)" }}>
              <p>Kein Zugriff auf diesen Bereich.</p>
              <button className="btn" onClick={() => navigate("dashboard")}>Zum Dashboard</button>
            </div>
          )}
          {hasViewAccess && view === "dashboard"  && <Dashboard data={data} setView={navigate} currentUser={currentUser} userPermissions={userPermissions} saveAll={save} />}
          {hasViewAccess && view === "pinnwand"  && <Pinboard  data={data} update={update} currentUser={currentUser} />}
          {hasViewAccess && view === "projects" && !selectedProjectId && <Projects data={data} update={update} saveAll={save} modal={modal} setModal={setModal} onSelect={setSelectedProjectId} setPrintContent={setPrintContent} currentUser={currentUser} userPermissions={userPermissions} />}
          {hasViewAccess && view === "projects" && selectedProjectId && <ProjectDetail data={data} update={update} saveAll={save} projectId={selectedProjectId} onBack={() => setSelectedProjectId(null)} setPrintContent={setPrintContent} modal={modal} setModal={setModal} currentUser={currentUser} userPermissions={userPermissions} />}
          {hasViewAccess && view === "time" && <Time data={data} update={update} currentUser={currentUser} userPermissions={userPermissions} setPrintContent={setPrintContent} />}
          {hasViewAccess && view === "crm" && <Crm data={data} update={update} setView={navigate} />}
          {hasViewAccess && view === "quotes" && <Quotes data={data} update={update} saveAll={save} modal={modal} setModal={setModal} setPrintContent={setPrintContent} setView={navigate} onSelectProject={setSelectedProjectId} />}
          {hasViewAccess && view === "contracts" && <Contracts data={data} update={update} saveAll={save} modal={modal} setModal={setModal} setPrintContent={setPrintContent} setView={navigate} />}
          {hasViewAccess && view === "dokumente" && <Documents data={data} setView={navigate} />}
          {hasViewAccess && view === "lieferscheine" && <DeliveryNotes data={data} update={update} saveAll={save} setPrintContent={setPrintContent} />}
          {hasViewAccess && view === "protokolle" && <Protocols data={data} update={update} saveAll={save} setPrintContent={setPrintContent} />}
          {hasViewAccess && view === "buchhaltung" && <Accounting data={data} update={update} setView={navigate} setPrintContent={setPrintContent} />}
          {hasViewAccess && view === "invoices" && <Invoices data={data} update={update} saveAll={save} modal={modal} setModal={setModal} setPrintContent={setPrintContent} setView={navigate} />}
          {hasViewAccess && view === "loehne" && <Payroll data={data} update={update} saveAll={save} setPrintContent={setPrintContent} setView={navigate} />}
          {hasViewAccess && view === "expenses" && <Expenses data={data} update={update} standalone setView={navigate} />}
          {hasViewAccess && view === "internal-expenses" && <InternalExpenses data={data} update={update} setView={navigate} />}
          {hasViewAccess && view === "personen" && <Persons data={data} update={update} saveAll={save} setView={navigate} />}
          {hasViewAccess && view === "mitarbeiter" && <Employees data={data} update={update} saveAll={save} setPrintContent={setPrintContent} />}
          {hasViewAccess && view === "letters" && <Letters data={data} update={update} setPrintContent={setPrintContent} />}
          {hasViewAccess && view === "settings" && <Settings data={data} update={update} currentUser={currentUser} uiZoom={uiZoom} setUiZoom={setUiZoom} setView={navigate} />}
          {(userPermissions === null || userPermissions.includes("settings")) && view === "dataImport" && <DataImport data={data} saveAll={save} setView={navigate} />}
          {hasViewAccess && view === "studio-budget" && <StudioBudget data={data} update={update} setView={navigate} setPrintContent={setPrintContent} />}
        </Suspense>
        </ErrorBoundary>
      </div>

      <UpdateNotifier />

      {showChangelog && (
        <ChangelogModal
          version={changelogVersion}
          onSelectVersion={setChangelogVersion}
          onClose={() => { setShowChangelog(false); localStorage.setItem("rapport_changelog_seen", LATEST_VERSION); }}
        />
      )}

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
