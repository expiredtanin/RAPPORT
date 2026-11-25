// Briefe: Vorlage wählen, Empfänger/Projekt einsetzen, Text im Rich-Text-Editor
// bearbeiten, drucken/als PDF speichern. Vorlagen liegen in `data.letterTemplates`;
// im Vorlagentext ersetzen die Platzhalter {{client}} und {{project}} Kunden- und
// Projektnamen; beim Speichern werden die eingesetzten Namen wieder zu Platzhaltern (letterToTemplate). Der Brieftext selbst wird nicht gespeichert, nur als Vorlage
// («Speichern» in die gewählte Vorlage / «Neue Vorlage»).

import { useState } from "react";
import { generateId, textToHtml, fillLetterTemplate, letterToTemplate } from "../utils";
import { showToast } from "../toast";
import { Header, FormField, RichEditor } from "../components/UI";
import LivePreview from "../components/LivePreview";
import { useConfirm } from "../hooks/useConfirm";
import type { ViewProps } from "../types";

export default
function Letters({ data, update, setPrintContent }: Pick<ViewProps, "data" | "update" | "setPrintContent">) {
  const [selectedTemplate, setSelectedTemplate] = useState(data.letterTemplates[0]?.id || "");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  // Lücken ({{client}}, {{project}}) schon beim Öffnen als «[Kunde]»/«[Projekt]» zeigen, wie nach einer Auswahl
  const [body, setBody] = useState(() => textToHtml(fillLetterTemplate(data.letterTemplates[0]?.body || "", {})));
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [subject, setSubject] = useState(data.letterTemplates[0]?.name || "");

  const nameOf = (cId: string, pId: string) => ({
    client: (data.persons || []).find(c => c.id === cId)?.name,
    project: data.projects.find(p => p.id === pId)?.name,
  });
  // Vorlage mit Kunde/Projekt füllen (neue Vorlage gewählt). Ist der Text schon bearbeitet, vorher fragen.
  const fillTemplate = async (tplId: string, cId: string, pId: string, ask = true) => {
    const tpl = data.letterTemplates.find(t => t.id === tplId);
    if (!tpl) return;
    const untouched = body === textToHtml(fillLetterTemplate(data.letterTemplates.find(t => t.id === selectedTemplate)?.body || "", nameOf(clientId, projectId)));
    if (ask && !untouched && !(await askConfirm("Den bearbeiteten Brieftext durch die Vorlage ersetzen?", "Ersetzen"))) return false;
    // Namen landen im HTML des Editors: fillLetterTemplate maskiert «&», «<» usw. (z.B. «Müller & Partner»)
    setBody(textToHtml(fillLetterTemplate(tpl.body || "", nameOf(cId, pId))));
    setSubject(tpl.name);
    return true;
  };
  // Kunde/Projekt gewechselt: im bestehenden Text nur die eingesetzten Namen austauschen (vorher ersetzte die
  // Auswahl den ganzen, evtl. schon geschriebenen Brief durch die Vorlage)
  const swapNames = (cId: string, pId: string) => {
    setBody(fillLetterTemplate(letterToTemplate(body, nameOf(clientId, projectId)), nameOf(cId, pId)));
  };

  const client = ((data.persons||[])).find(c => c.id === clientId);

  // Name der neuen Vorlage im Feld unter der Auswahl (kein window.prompt: im Tauri-WebView stumm); null = zu
  const [newName, setNewName] = useState<string | null>(null);
  const saveAsTemplate = () => {
    const name = (newName || "").trim();
    if (!name) return;
    const tpl = { id: generateId(), name, body: asTemplate() };
    update("letterTemplates", [...data.letterTemplates, tpl]);
    setSelectedTemplate(tpl.id);
    setSubject(name);
    setNewName(null);
  };

  // Gespeichert wird mit Platzhaltern statt der eingesetzten Namen (sonst wäre die Vorlage an einen Kunden gebunden)
  const asTemplate = () => letterToTemplate(body, {
    client: (data.persons || []).find(c => c.id === clientId)?.name,
    project: data.projects.find(p => p.id === projectId)?.name,
  });
  const updateTemplate = () => {
    update("letterTemplates", data.letterTemplates.map(t => t.id === selectedTemplate ? { ...t, body: asTemplate() } : t));
    showToast("Vorlage überschrieben — Kunden- und Projektname als Platzhalter gespeichert.");
  };

  const deleteTemplate = async () => {
    if (!(await askConfirm("Vorlage löschen?"))) return;
    const remaining = data.letterTemplates.filter(t => t.id !== selectedTemplate);
    update("letterTemplates", prev => (prev || []).filter(t => t.id !== selectedTemplate));   // nach der Rückfrage: aktueller Stand
    setSelectedTemplate(remaining[0]?.id || "");
    void fillTemplate(remaining[0]?.id || "", clientId, projectId, false);
  };

  // Vorschau rechts standardmässig auf breiten Fenstern
  const [showPreview, setShowPreview] = useState(() => typeof window === "undefined" || window.innerWidth >= 1300);

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Briefe" action={<>
        <button className={`btn ${showPreview ? "btn-ghost" : "btn-quiet"}`} onClick={() => setShowPreview(v => !v)} aria-pressed={showPreview}>
          <span className="msr" style={{ fontSize: 17 }}>{showPreview ? "visibility_off" : "visibility"}</span>Vorschau
        </button>
        <button className="btn btn-primary" onClick={() => setPrintContent({ type: "letter", client, subject, body, isHtml: true, settings: data.settings })}>
          Drucken / PDF
        </button>
      </>} />
      <div className="letters-grid" style={{ display: "grid", gridTemplateColumns: showPreview ? "280px minmax(0, 1fr) minmax(320px, 0.9fr)" : "280px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>

        {/* Linke Spalte */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text4)", fontWeight: 600, marginBottom: 12 }}>VORLAGE</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <select value={selectedTemplate} onChange={async e => { const id = e.target.value; if (await fillTemplate(id, clientId, projectId) !== false) setSelectedTemplate(id); }} style={{ flex: 1, minWidth: 0 }}>
                {data.letterTemplates.length === 0 && <option value="">— keine Vorlage —</option>}
                {data.letterTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn-icon danger" style={{ flex: "none" }} disabled={!selectedTemplate} title="Vorlage löschen" aria-label="Vorlage löschen" onClick={deleteTemplate}><span className="msr" style={{ fontSize: 17 }}>delete</span></button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, minWidth: 0, justifyContent: "center" }} disabled={!selectedTemplate} title="Aktuellen Text in die gewählte Vorlage speichern" onClick={updateTemplate}>Speichern</button>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, minWidth: 0, justifyContent: "center", whiteSpace: "nowrap" }} title="Aktuellen Text als neue Vorlage speichern" onClick={() => setNewName(subject || "")}>Neue Vorlage</button>
            </div>
            {newName !== null && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name der neuen Vorlage"
                  onKeyDown={e => { if (e.key === "Enter") saveAsTemplate(); if (e.key === "Escape") setNewName(null); }} style={{ flex: 1, fontSize: 12 }} />
                <button className="btn btn-primary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={!newName.trim()} onClick={saveAsTemplate}>Speichern</button>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text4)", fontWeight: 600, marginBottom: 12 }}>EMPFÄNGER</div>
            <FormField label="Kunde">
              <select value={clientId} onChange={e => { swapNames(e.target.value, projectId); setClientId(e.target.value); }}>
                <option value="">— wählen —</option>
                {((data.persons||[])).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Projekt (optional)">
              <select value={projectId} onChange={e => { swapNames(clientId, e.target.value); setProjectId(e.target.value); }}>
                <option value="">— keines —</option>
                {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
          </div>

          <div className="card" style={{ fontSize: 11, color: "var(--text5)", lineHeight: 1.7 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text4)", fontWeight: 600, marginBottom: 8 }}>PLATZHALTER</div>
            <code style={{ fontSize: 10, background: "var(--surface2)", padding: "1px 5px", borderRadius: 3 }}>{"{{client}}"}</code> Kundenname<br/>
            <code style={{ fontSize: 10, background: "var(--surface2)", padding: "1px 5px", borderRadius: 3, marginTop: 4, display: "inline-block" }}>{"{{project}}"}</code> Projektname
          </div>
        </div>

        {/* Editor */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border2)" }}>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Betreff / Titel"
              style={{ fontSize: 15, fontWeight: 500, border: "none", background: "transparent", color: "var(--text)", width: "100%", outline: "none", height: "auto" }}
            />
          </div>
          <div style={{ padding: "0" }}>
            <RichEditor value={body} onChange={setBody} />
          </div>
        </div>

        {/* Live-Vorschau wie im Druck (mit Seitenumbrüchen) */}
        {showPreview && (
          <div className="card" style={{ background: "var(--surface2)", padding: 16, position: "sticky", top: 0 }}>
            <LivePreview settings={data.settings} assets={data.docAssets} content={{ type: "letter", client, subject, body }} />
          </div>
        )}

      </div>
    </div>
  );
}
