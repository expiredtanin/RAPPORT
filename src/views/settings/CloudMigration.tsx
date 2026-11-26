// Dialog «Daten in die Cloud übertragen» (Einstellungen → System). Zwei Fälle:
//   mode "local"  — lokaler Speicher oder Datenordner → Büro auf einem PocketBase-Server; danach Umstellung
//                   des Speichers auf die Cloud. Schritte: Server → Konto/Büro → Prüfen → Übertragen → Ergebnis.
//   mode "backup" — im Cloud-Modus ein JSON-Backup ins aktive (leere) Büro übertragen. Schritte: Prüfen → …
// Die Ablauflogik (Plan, Leer-Prüfung, Übertragung, Prüfung lokal vs. Cloud) steckt in storage/cloud-migrate.ts;
// hier nur Eingaben, Anzeige und die Umstellung (localStorage `rapport_backend`/`rapport_cloud_url`, Hinweis
// `rapport_cloud_migrated`, Einladeliste `rapport_cloud_invites` für «Team»). Die lokalen Daten bleiben
// unverändert liegen (Sicherung), dazu wird vor dem Übertragen ein vollständiges JSON-Backup heruntergeladen.

import { useEffect, useMemo, useRef, useState } from "react";
import { PocketBaseAdapter, CLOUD_DATA_KEYS } from "../../storage/pocketbase-adapter";
import { cloudStorage, flushStorage } from "../../storage/adapter";
import {
  checkTarget, planBlocked, planMigration, prepareForCloud, runMigration,
  writePendingInvites, type AreaCount, type AreaResult, type CloudMigratedNote, type MigrationResult,
} from "../../storage/cloud-migrate";
import { localISODate } from "../../utils";
import { Modal } from "../../components/UI";
import type { AppData, CurrentUser, Id } from "../../types";

/** Wort, das zum Überschreiben eines Büros mit Daten eingetippt werden muss. */
const CONFIRM_WORD = "ÜBERSCHREIBEN";

/** Lädt `value` als JSON-Datei herunter. */
function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slugFor = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "studio"}-${Date.now().toString(36)}`;
const errText = (e: unknown) => {
  const err = e as { data?: { message?: string }; message?: string };
  return err?.data?.message || err?.message || String(e);
};

type Step = "connect" | "account" | "review" | "run" | "done";
interface Target { adapter: PocketBaseAdapter; studioId: Id; studioName: string; userId: Id; displayName: string; username: string; isNew: boolean }

const box = (tone: "info" | "warn" | "error") => ({
  fontSize: 12, lineHeight: 1.6, padding: "10px 12px", borderRadius: 6, marginBottom: 12,
  border: `1px solid ${tone === "error" ? "var(--negative)" : "var(--border2)"}`,
  background: tone === "error" ? "var(--negative-bg)" : "var(--surface2)",
  color: tone === "error" ? "var(--negative)" : "var(--text3)",
});
const label = { display: "block", fontSize: 9, letterSpacing: "0.12em", color: "var(--text4)", margin: "12px 0 5px", fontWeight: 500 } as const;

/**
 * @param mode "local" (lokal/Datenordner → Cloud) oder "backup" (JSON-Backup → aktives Cloud-Büro)
 * @param data Quelle (aktueller Stand bzw. migriertes Backup)
 * @param resolveFiles Datenordner: Verweise «rapport-datei:» durch Dateiinhalte ersetzen (fileStorage.embedAttachments)
 * @param onBackup lädt eine vollständige Sicherung des aktuellen Stands herunter (wie «Backup als JSON»)
 */
export function CloudMigration({ mode, data, currentUser, resolveFiles, onBackup, onClose, source, cloudUserIds = [] }: {
  mode: "local" | "backup";
  data: AppData;
  currentUser: CurrentUser | null;
  resolveFiles?: (d: AppData) => Promise<AppData>;
  onBackup: () => Promise<void>;
  onClose: () => void;
  /** Herkunft im Modus "local" (für den Hinweis nach dem Umzug). */
  source?: { from: "local" | "file"; dir?: string | null };
  /** Modus "backup": Konten, die im Büro schon Mitglied sind (Verknüpfung zum Mitarbeitenden bleibt). */
  cloudUserIds?: Id[];
}) {
  const [step, setStep] = useState<Step>(mode === "backup" ? "review" : "connect");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Verbindung
  const [url, setUrl] = useState(() => localStorage.getItem("rapport_cloud_url") || "https://");
  const [adapter, setAdapter] = useState<PocketBaseAdapter | null>(null);
  const [serverEmpty, setServerEmpty] = useState(false);
  // Konto
  const [acc, setAcc] = useState({ name: currentUser?.displayName || "", email: "", password: "", confirm: "", studioName: data.settings?.name || "", setupCode: "" });
  const [studios, setStudios] = useState<{ id: Id; name: string }[] | null>(null);
  const [choice, setChoice] = useState<string>("new");
  const [signedIn, setSignedIn] = useState<{ userId: Id; displayName: string; username: string } | null>(null);
  // Ziel und Prüfung
  const [target, setTarget] = useState<Target | null>(() => mode === "backup" && currentUser ? {
    adapter: cloudStorage, studioId: sessionStorage.getItem("rapport_studio_id") || "", studioName: data.settings?.name || "",
    userId: currentUser.id, displayName: currentUser.displayName, username: currentUser.username, isNew: false,
  } : null);
  const [filled, setFilled] = useState<AreaCount[] | null>(null);
  const [ownTarget, setOwnTarget] = useState(false); // dieses Büro hat der Dialog schon (teilweise) befüllt
  const [typed, setTyped] = useState("");
  const [prepared, setPrepared] = useState<AppData | null>(null);
  // Übertragung
  const [progress, setProgress] = useState<AreaResult[]>([]);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selfUserId = mode === "local" ? currentUser?.id ?? null : null;
  const plan = useMemo(() => planMigration(prepared || data, CLOUD_DATA_KEYS, selfUserId), [prepared, data, selfUserId]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError("");
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(""); }
  };

  /** Ziel steht fest: Belege auflösen und Ziel-Büro auf Daten prüfen. */
  const enterReview = async (t: Target) => {
    setTarget(t);
    t.adapter.setStudioId(t.studioId);
    if (!prepared) setPrepared(resolveFiles ? await resolveFiles(data) : data);
    setFilled((await checkTarget(t.adapter, CLOUD_DATA_KEYS)).filled);
    setStep("review");
  };

  // ── Schritt 1: Server ───────────────────────────────────────────────────
  const connect = () => run("Verbinde …", async () => {
    const clean = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/.test(clean)) throw new Error("Bitte die Server-Adresse mit http:// oder https:// angeben.");
    const a = new PocketBaseAdapter(clean);
    const ok = await a.testConnection();
    if (!ok.ok) throw new Error(`Server nicht erreichbar: ${ok.error || "keine Antwort"}`);
    const list = await a.listStudios();
    setUrl(clean); setAdapter(a); setServerEmpty(list.length === 0); setStep("account");
  });

  // ── Schritt 2a: Ersteinrichtung (Server ohne Büro) ──────────────────────
  const setupAccount = () => run("Konto und Büro werden angelegt …", async () => {
    if (!adapter) return;
    if (!acc.name.trim() || !acc.studioName.trim()) throw new Error("Bitte Namen und Büro angeben.");
    if (!/.+@.+\..+/.test(acc.email.trim())) throw new Error("Bitte eine gültige E-Mail-Adresse angeben.");
    if (acc.password.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen.");
    if (acc.password !== acc.confirm) throw new Error("Die Passwörter stimmen nicht überein.");
    adapter.setupCode = acc.setupCode || "";
    const up = await adapter.signUp(acc.email.trim(), acc.password);
    if (!up.ok || !up.user) throw new Error(up.error || "Konto konnte nicht angelegt werden.");
    const username = (acc.email.split("@")[0] || "user").replace(/[^a-zA-Z0-9._-]/g, "");
    await adapter.ensureProfile(username, acc.name.trim());
    const studioId = await adapter.createStudio(acc.studioName.trim(), slugFor(acc.studioName.trim()));
    await enterReview({ adapter, studioId, studioName: acc.studioName.trim(), userId: up.user.id, displayName: acc.name.trim(), username, isNew: true });
  });

  // ── Schritt 2b: Anmelden (Server mit Büros) ─────────────────────────────
  const signIn = () => run("Anmelden …", async () => {
    if (!adapter) return;
    const res = await adapter.signIn(acc.email.trim(), acc.password);
    if (!res) throw new Error("E-Mail oder Passwort ist falsch.");
    const admin = res.studios.filter(m => m.app_role_id === "r-admin").map(m => ({ id: m.studio_id as Id, name: m.studios?.name || "Büro" }));
    if (admin.length === 0) throw new Error("Dieses Konto ist in keinem Büro Admin. Neue Büros legen nur Admins an — bitte die Administration des Servers fragen.");
    setSignedIn({ userId: res.user.id, displayName: res.profile.display_name || res.user.email, username: res.profile.username || res.user.email });
    setStudios(admin);
  });
  const chooseStudio = () => run("Büro wird geprüft …", async () => {
    if (!adapter || !signedIn) return;
    if (choice === "new") {
      if (!acc.studioName.trim()) throw new Error("Bitte einen Namen für das neue Büro angeben.");
      const studioId = await adapter.createStudio(acc.studioName.trim(), slugFor(acc.studioName.trim()));
      await enterReview({ adapter, studioId, studioName: acc.studioName.trim(), ...signedIn, isNew: true });
    } else {
      await enterReview({ adapter, studioId: choice, studioName: studios?.find(s => s.id === choice)?.name || "", ...signedIn, isNew: false });
    }
  });

  // Modus "backup": Ziel ist das aktive Büro — beim Öffnen einmal prüfen
  const backupChecked = useRef(false);
  useEffect(() => {
    if (mode !== "backup" || !target || backupChecked.current) return;
    backupChecked.current = true;
    void run("Büro wird geprüft …", () => enterReview(target));
  });

  // ── Schritt 3/4: Sicherung, Übertragung, Prüfung ────────────────────────
  const mustType = !!filled?.length && !ownTarget;
  const start = () => run("", async () => {
    if (!target || !prepared) return;
    if (mustType && typed.trim() !== CONFIRM_WORD) throw new Error(`Zum Überschreiben bitte «${CONFIRM_WORD}» eintippen.`);
    // 1. Sicherung des bisherigen Stands (lokal bzw. Backup liegt schon als Datei vor)
    if (mode === "local" && !ownTarget) {
      await flushStorage();
      await onBackup();
    }
    // Büro mit Daten: vorher dessen Stand sichern
    if (mustType) {
      const before = await target.adapter.embedAttachments(await target.adapter.load());
      downloadJson(before, `cloud-backup-${slugFor(target.studioName).replace(/-[a-z0-9]+$/, "")}-${localISODate()}.json`);
    }
    setOwnTarget(true);
    setStep("run");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const userMap: Record<Id, Id> = selfUserId ? { [selfUserId]: target.userId } : {};
    const res = await runMigration(prepareForCloud(prepared, userMap, cloudUserIds), target.adapter, CLOUD_DATA_KEYS, { onProgress: setProgress, signal: ctrl.signal });
    abortRef.current = null;
    setResult(res);
    setStep("done");
  });

  // ── Schritt 5: Umstellen ────────────────────────────────────────────────
  const switchToCloud = () => run("Umstellen …", async () => {
    if (!target) return;
    if (mode === "backup") { window.location.reload(); return; }
    localStorage.setItem("rapport_backend", "cloud");
    localStorage.setItem("rapport_backend_chosen", "1");
    localStorage.setItem("rapport_cloud_url", url);
    // Sonst setzt die 0.8.0-Aufräumregel (Cloud + lokale Daten + kein Login) den Wechsel nach dem Abmelden zurück
    localStorage.setItem("rapport_080_recovery", "1");
    const note: CloudMigratedNote = { at: localISODate(), from: source?.from || "local", dir: source?.dir ?? null, studio: target.studioName };
    localStorage.setItem("rapport_cloud_migrated", JSON.stringify(note));
    writePendingInvites(plan.invites);
    // Sitzung direkt übernehmen (der Anmelde-Token liegt schon in rapport_pocketbase_auth)
    const employeeId = (prepared?.employees || []).find(e => selfUserId && (e.appUserId === selfUserId || data.users.find(u => u.id === selfUserId)?.employeeId === e.id))?.id || null;
    sessionStorage.setItem("rapport_studio_id", target.studioId);
    sessionStorage.setItem("rapport_user", JSON.stringify({ id: target.userId, username: target.username, displayName: target.displayName, role: "admin", appRoleId: "r-admin", employeeId }));
    window.location.reload();
  });

  const close = () => {
    if (step === "run") return; // erst abbrechen
    if (mode === "local") adapter?.client.authStore.clear();
    onClose();
  };

  const input = (key: keyof typeof acc, type = "text", placeholder = "") => (
    <input className="login-input" type={type} value={acc[key]} placeholder={placeholder}
      onChange={e => setAcc(a => ({ ...a, [key]: e.target.value }))} />
  );
  const table = (rows: AreaResult[], withCloud: boolean) => (
    <div style={{ border: "1px solid var(--border2)", borderRadius: 8, maxHeight: 300, overflowY: "auto", marginBottom: 12 }}>
      {rows.map(a => {
        const bad = a.state === "Fehler" || (withCloud && a.cloud !== a.local);
        return (
          <div key={a.key} style={{ display: "flex", gap: 10, padding: "5px 10px", fontSize: 12, borderBottom: "1px solid var(--border2)", color: bad ? "var(--negative)" : "var(--text)" }}>
            <span style={{ flex: 1 }}>{a.label}{a.error && <span style={{ display: "block", fontSize: 11 }}>{a.error}</span>}</span>
            <span style={{ width: 70, textAlign: "right", color: "var(--text4)" }}>lokal {a.local}</span>
            {withCloud && <span style={{ width: 70, textAlign: "right" }}>Cloud {a.cloud ?? "?"}</span>}
            <span style={{ width: 90, textAlign: "right", color: a.state === "fertig" ? "var(--positive)" : undefined }}>{a.state === "läuft" ? "läuft …" : a.state}</span>
          </div>
        );
      })}
    </div>
  );
  const btn = (text: string, onClick: () => void, kind = "btn-primary", disabled = false) =>
    <button className={`btn ${kind}`} disabled={!!busy || disabled} onClick={onClick}>{text}</button>;

  return (
    <Modal title={mode === "backup" ? "Backup in dieses Büro übertragen" : "Daten in die Cloud übertragen"} onClose={close} hideFooter confirmClose={false}>
      <div style={{ maxWidth: 560 }}>
        {error && <div style={box("error")}>{error}</div>}
        {busy && <div style={box("info")}>{busy}</div>}

        {step === "connect" && (<>
          <p style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7 }}>
            Alle Daten dieses Büros (inkl. Belege, Logo und Bilder) werden in ein Büro auf einem Rapport-Server übertragen.
            Vorher wird automatisch eine vollständige Sicherung gespeichert; die bisherigen Daten bleiben unverändert erhalten.
          </p>
          <label style={label}>SERVER-ADRESSE</label>
          <input className="login-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://rapport.mein-buero.ch" onKeyDown={e => e.key === "Enter" && connect()} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            {btn("Abbrechen", close, "btn-ghost")}{btn("Verbinden", connect)}
          </div>
        </>)}

        {step === "account" && serverEmpty && (<>
          <div style={box("info")}>Der Server ist noch leer. Sie legen jetzt Ihr Admin-Konto und das Büro an.</div>
          <label style={label}>IHR NAME</label>{input("name")}
          <label style={label}>E-MAIL (ANMELDUNG)</label>{input("email", "email")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={label}>PASSWORT</label>{input("password", "password", "mindestens 8 Zeichen")}</div>
            <div><label style={label}>WIEDERHOLEN</label>{input("confirm", "password")}</div>
          </div>
          <label style={label}>BÜRO</label>{input("studioName")}
          <label style={label}>EINRICHTUNGSCODE</label>{input("setupCode", "text", "aus dem Server-Log («Einrichtungscode»)")}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            {btn("Zurück", () => setStep("connect"), "btn-ghost")}{btn("Konto und Büro anlegen", setupAccount)}
          </div>
        </>)}

        {step === "account" && !serverEmpty && !studios && (<>
          <div style={box("info")}>
            Auf dem Server gibt es schon Büros. Melden Sie sich mit Ihrem Cloud-Konto an (Admin eines Büros). Lokale Benutzer
            lassen sich nicht übernehmen, weil ihre Passwörter nur verschlüsselt vorliegen.
          </div>
          <label style={label}>E-MAIL</label>{input("email", "email")}
          <label style={label}>PASSWORT</label>{input("password", "password")}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            {btn("Zurück", () => setStep("connect"), "btn-ghost")}{btn("Anmelden", signIn)}
          </div>
        </>)}

        {step === "account" && studios && (<>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 10 }}>Wohin sollen die Daten?</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "6px 0" }}>
            <input type="radio" style={{ width: "auto" }} checked={choice === "new"} onChange={() => setChoice("new")} /> Neues Büro anlegen (empfohlen)
          </label>
          {choice === "new" && input("studioName", "text", "Name des Büros")}
          {studios.map(s => (
            <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "6px 0" }}>
              <input type="radio" style={{ width: "auto" }} checked={choice === s.id} onChange={() => setChoice(s.id)} /> Bestehendes Büro «{s.name}» (nur wenn es leer ist)
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            {btn("Abbrechen", close, "btn-ghost")}{btn("Weiter", chooseStudio)}
          </div>
        </>)}

        {step === "review" && target && filled && (<>
          <div style={{ fontSize: 13, marginBottom: 10 }}>Ziel: <strong>{target.studioName}</strong>{target.isNew ? " (neu angelegt)" : ""}</div>
          {table(plan.areas.filter(a => a.count > 0).map(a => ({ key: a.key, label: a.label, local: a.count, cloud: null, state: "wartet" })), false)}
          {planBlocked(plan) && (
            <div style={box("error")}>
              Einige Datensätze haben Ids, die der Server nicht annimmt (erlaubt: Buchstaben, Ziffern, Bindestrich; eindeutig):{" "}
              {plan.badIds.map(b => `${b.label}: ${b.ids.slice(0, 5).join(", ")}${b.ids.length > 5 ? " …" : ""}`).join(" · ")}. Der Umzug ist so nicht möglich.
            </div>
          )}
          {filled.length > 0 && !ownTarget && (
            <div style={box("error")}>
              Dieses Büro enthält bereits Daten ({filled.map(f => `${f.label} ${f.count}`).join(", ")}). Es wird nicht überschrieben —
              wählen Sie besser ein neues Büro. Nur wenn diese Daten wirklich ersetzt werden sollen, tippen Sie «{CONFIRM_WORD}» ein
              (der bisherige Stand des Büros wird vorher als Datei gesichert).
              <input className="login-input" style={{ marginTop: 8 }} value={typed} onChange={e => setTyped(e.target.value)} placeholder={CONFIRM_WORD} />
            </div>
          )}
          {filled.length > 0 && ownTarget && <div style={box("warn")}>Das Büro enthält Daten aus dem letzten Versuch. Ein erneuter Lauf ergänzt und korrigiert sie (nichts wird doppelt angelegt).</div>}
          {plan.localOnlyFields.length > 0 && (
            <div style={box("warn")}>
              Diese Angaben speichert die Cloud noch nicht und übernimmt sie darum nicht: {plan.localOnlyFields.join(", ")}.
              Sie bleiben in der Sicherung und in den bisherigen Daten erhalten.
            </div>
          )}
          {plan.localOnly.length > 0 && (
            <div style={box("warn")}>
              Noch nicht in der Cloud gespeichert und deshalb nicht übertragen: {plan.localOnly.map(a => `${a.label} (${a.count})`).join(", ")}.
              Diese Einträge bleiben in der Sicherung und in den bisherigen Daten erhalten.
            </div>
          )}
          {plan.rejectedFiles.length > 0 && (
            <div style={box("warn")}>
              {plan.rejectedFiles.length} Anhänge nimmt der Server nicht an (Dateityp oder Grösse) und werden ohne Datei übertragen; sie bleiben in der Sicherung: {plan.rejectedFiles.slice(0, 3).join(", ")}{plan.rejectedFiles.length > 3 ? " …" : ""}.
            </div>
          )}
          {plan.unresolvedFiles.length > 0 && (
            <div style={box("warn")}>
              {plan.unresolvedFiles.length} Anhänge liegen nicht im Datenordner (z.B. noch nicht aus iCloud geladen) und fehlen danach in der Cloud: {plan.unresolvedFiles.slice(0, 3).join(", ")}{plan.unresolvedFiles.length > 3 ? " …" : ""}.
            </div>
          )}
          <div style={box("info")}>
            {mode === "local"
              ? "Zuerst wird eine vollständige Sicherung (JSON mit allen Belegen) heruntergeladen. Die Übertragung kann bei vielen Einträgen einige Minuten dauern (der Server nimmt höchstens 20 neue Einträge in 5 Sekunden an)."
              : "Die Übertragung kann bei vielen Einträgen einige Minuten dauern (der Server nimmt höchstens 20 neue Einträge in 5 Sekunden an)."}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            {btn("Abbrechen", close, "btn-ghost")}
            {btn(mode === "local" && !ownTarget ? "Sicherung speichern und übertragen" : "Übertragen", start, mustType ? "btn-danger" : "btn-primary",
              planBlocked(plan) || (mustType && typed.trim() !== CONFIRM_WORD))}
          </div>
        </>)}

        {step === "run" && (<>
          {table(progress, false)}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" disabled={!abortRef.current || abortRef.current.signal.aborted}
              onClick={() => { abortRef.current?.abort(); setProgress(p => [...p]); }}>
              {abortRef.current?.signal.aborted ? "Wird nach dem laufenden Bereich abgebrochen …" : "Abbrechen"}
            </button>
          </div>
        </>)}

        {step === "done" && result && target && (<>
          {result.complete
            ? <div style={{ ...box("info"), color: "var(--positive)", background: "var(--positive-bg)" }}>Alle Daten sind übertragen und geprüft: die Anzahl stimmt in jedem Bereich.</div>
            : <div style={box("error")}>
                {result.aborted ? "Abgebrochen. " : result.failedAt ? "Die Übertragung wurde wegen eines Fehlers angehalten. " : "Die Prüfung zeigt Abweichungen. "}
                Im Cloud-Büro «{target.studioName}» liegt jetzt nur ein Teil der Daten (siehe Tabelle). Ihre bisherigen Daten sind unverändert.
                Erneut übertragen ins selbe Büro ergänzt die fehlenden Einträge.
              </div>}
          {table(result.areas, true)}
          {result.complete && mode === "local" && plan.invites.length > 0 && (
            <div style={box("info")}>
              <strong>Diese Mitarbeitenden noch einladen</strong> (Einstellungen → Team, die Liste steht dort bereit; die Verknüpfung zum Mitarbeitenden wird beim Einladen gesetzt):
              <ul style={{ margin: "6px 0 0 18px" }}>
                {plan.invites.map(i => <li key={i.username}>{i.name} (bisher «{i.username}»)</li>)}
              </ul>
            </div>
          )}
          {result.complete && mode === "local" && (
            <div style={box("info")}>
              Nach dem Umstellen arbeitet Rapport mit dem Server. Die bisherigen Daten bleiben als Sicherung liegen
              ({source?.from === "file" ? `im Datenordner ${source.dir || ""}` : "im lokalen Speicher dieser App"}), dazu die heruntergeladene Datei studio-backup-{localISODate()}.json.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            {btn(result.complete ? "Schliessen" : "Schliessen (bisherige Daten behalten)", close, "btn-ghost")}
            {!result.complete && btn("Erneut übertragen", start, "btn-ghost")}
            {result.complete && btn(mode === "local" ? "Auf Cloud umstellen" : "Neu laden", switchToCloud)}
          </div>
        </>)}
      </div>
    </Modal>
  );
}
