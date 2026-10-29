// Briefe: Vorlage wählen, Empfänger/Projekt einsetzen, Text im Rich-Text-Editor
// bearbeiten, drucken/als PDF speichern. Vorlagen liegen in `data.letterTemplates`;
// im Vorlagentext ersetzen die Platzhalter {{client}} und {{project}} Kunden- und
// Projektnamen. Der Brieftext selbst wird nicht gespeichert, nur als Vorlage
// («Überschreiben» / «Neu speichern»).

import { useState } from "react";
import { generateId, textToHtml } from "../utils";
import { Header, FormField, RichEditor } from "../components/UI";
import { useConfirm } from "../hooks/useConfirm";
import type { ViewProps } from "../types";

export default
function Letters({ data, update, setPrintContent }: Pick<ViewProps, "data" | "update" | "setPrintContent">) {
  const [selectedTemplate, setSelectedTemplate] = useState(data.letterTemplates[0]?.id || "");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [body, setBody] = useState(() => textToHtml(data.letterTemplates[0]?.body || ""));
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const [subject, setSubject] = useState(data.letterTemplates[0]?.name || "");

  // Vorlage mit Kunde/Projekt füllen; läuft bei jeder Auswahländerung (überschreibt den Text wie bisher)
  const fillTemplate = (tplId: string, cId: string, pId: string) => {
    const tpl = data.letterTemplates.find(t => t.id === tplId);
    if (!tpl) return;
    const client = (data.persons || []).find(c => c.id === cId);
    const proj = data.projects.find(p => p.id === pId);
    const text = (tpl.body || "")
      .replace(/\{\{client\}\}/g, client?.name || "[Kunde]")
      .replace(/\{\{project\}\}/g, proj?.name || "[Projekt]");
    setBody(textToHtml(text));
    setSubject(tpl.name);
  };

  const client = ((data.persons||[])).find(c => c.id === clientId);

  const saveAsTemplate = () => {
    const name = prompt("Name der neuen Vorlage?");
    if (!name) return;
    const tpl = { id: generateId(), name, body };
    update("letterTemplates", [...data.letterTemplates, tpl]);
    setSelectedTemplate(tpl.id);
    setSubject(name);
  };

  const updateTemplate = () => {
    update("letterTemplates", data.letterTemplates.map(t => t.id === selectedTemplate ? { ...t, body } : t));
  };

  const deleteTemplate = async () => {
    if (!(await askConfirm("Vorlage löschen?"))) return;
    const remaining = data.letterTemplates.filter(t => t.id !== selectedTemplate);
    update("letterTemplates", remaining);
    setSelectedTemplate(remaining[0]?.id || "");
    fillTemplate(remaining[0]?.id || "", clientId, projectId);
  };

  return (
    <div>
      {ConfirmModalEl}
      <Header title="Briefe" action={
        <button className="btn btn-primary" onClick={() => setPrintContent({ type: "letter", client, subject, body, isHtml: true, settings: data.settings })}>
          Drucken / PDF
        </button>
      } />
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>

        {/* Linke Spalte */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text4)", fontWeight: 600, marginBottom: 12 }}>VORLAGE</div>
            <select value={selectedTemplate} onChange={e => { setSelectedTemplate(e.target.value); fillTemplate(e.target.value, clientId, projectId); }} style={{ marginBottom: 10 }}>
              {data.letterTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost" style={{ flex: 1, fontSize: 11, padding: "5px 8px" }} onClick={updateTemplate}>Überschreiben</button>
              <button className="btn btn-ghost" style={{ flex: 1, fontSize: 11, padding: "5px 8px" }} onClick={saveAsTemplate}>Neu speichern</button>
              <button className="btn btn-ghost" style={{ padding: "5px 8px", fontSize: 11 }} onClick={deleteTemplate}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text4)", fontWeight: 600, marginBottom: 12 }}>EMPFÄNGER</div>
            <FormField label="Kunde">
              <select value={clientId} onChange={e => { setClientId(e.target.value); fillTemplate(selectedTemplate, e.target.value, projectId); }}>
                <option value="">— wählen —</option>
                {((data.persons||[])).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Projekt (optional)">
              <select value={projectId} onChange={e => { setProjectId(e.target.value); fillTemplate(selectedTemplate, clientId, e.target.value); }}>
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

      </div>
    </div>
  );
}
