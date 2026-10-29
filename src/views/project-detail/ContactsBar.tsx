// Zeile «Beteiligte» der Projekt-Detailansicht: Firmen mit ausgewählten Ansprechpersonen als Chips.

import { type ViewProps, type Project } from "../../types";

/** Chips der Projektbeteiligten (Firma + gewählte Personen). */
export function ContactsBar({ project, data }: {
  project: Project;
  data: ViewProps["data"];
}) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
      <span style={{ fontSize: 10, color: "var(--text5)", letterSpacing: "0.1em", fontWeight: 600, flexShrink: 0 }}>BETEILIGTE</span>
      {(project.projectContacts || []).map(pc => {
        const firm = (data.persons || []).find(p => p.id === pc.contactId);
        if (!firm) return null;
        const selectedPersons = (firm.contacts || []).filter(p => (pc.personIds || []).includes(p.id));
        return (
          <div key={pc.contactId} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 10px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>{firm.name}</span>
            {firm.type && <span style={{ fontSize: 10, color: "var(--text5)" }}>{firm.type}</span>}
            {selectedPersons.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text3)", borderLeft: "1px solid var(--border)", paddingLeft: 6 }}>
                {selectedPersons.map(p => p.name).join(", ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
