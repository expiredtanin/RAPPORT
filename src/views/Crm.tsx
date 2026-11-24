// Akquise (CRM): Einstiegs-View des Nav-Eintrags «Akquise» (Permission-Id `crm`).
// Kopfzeile mit Tab-Wechsel zwischen Pipeline (Board), Auswertung (Zahlen) und Kundenpflege (Liste).
// Der gewählte Tab wird nicht gespeichert; die App öffnet immer in der Pipeline. «+ Neuer Lead» steht im Seitenkopf
// und meldet sich über einen Zähler (`newRequest`) bei CrmPipeline.

import { useState } from "react";
import { Header, PageTabs } from "../components/UI";
import { isCloudBackend } from "../storage/adapter";
import CrmPipeline from "./CrmPipeline";
import CrmAuswertung from "./CrmAuswertung";
import CrmKundenpflege from "./CrmKundenpflege";
import type { ViewProps } from "../types";

const TABS = [{ id: "pipeline", label: "Pipeline" }, { id: "auswertung", label: "Auswertung" }, { id: "kundenpflege", label: "Kundenpflege" }] as const;

export default function Crm({ data, update, setView }: Pick<ViewProps, "data" | "update" | "setView">) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("pipeline");
  const [newLead, setNewLead] = useState(0);
  return (
    <div>
      <Header title="Akquise"
        action={tab === "pipeline" && <button className="btn btn-primary" onClick={() => setNewLead(n => n + 1)}>+ Neuer Lead</button>}
        tabs={<PageTabs tabs={[...TABS]} value={tab} onChange={setTab} />} />
      {isCloudBackend && (
        // Leads/Aktivitäten stehen noch nicht in der Cloud-Zuordnung des PocketBase-Adapters (ENTITY_MAP).
        <div style={{ background: "var(--surface2)", border: "1px solid var(--warning)", color: "var(--text2)", borderRadius: 12, padding: "10px 14px", fontSize: 12, marginBottom: 16 }}>
          <strong>Cloud-Modus:</strong> Akquise-Daten (Leads, Kontaktverlauf, Herkunft und Empfehler bei Personen) werden noch nicht mit dem Server synchronisiert und sind nach dem Neuladen weg. Nur im lokalen Modus nutzbar.
        </div>
      )}
      {tab === "pipeline" && <CrmPipeline data={data} update={update} setView={setView} newRequest={newLead} />}
      {tab === "auswertung" && <CrmAuswertung data={data} setView={setView} />}
      {tab === "kundenpflege" && <CrmKundenpflege data={data} update={update} />}
    </div>
  );
}
