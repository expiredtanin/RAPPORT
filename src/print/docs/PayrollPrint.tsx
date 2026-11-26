// Druckvorlage Lohnabrechnung (`lohn`).

import { formatCHF, formatDate, formatSenderAddress, formatIban, monatsAnteilNachEintritt, ahvStatus } from "../../utils";
import { lohnAGBeitraege } from "../../accounting";
import { StudioLogo } from "../../components/UI";
import type { AppData, Employee, LohnEntry, Settings } from "../../types";
import { HEADING } from "./shared";

/** Zeile der Lohnabrechnung (Bezeichnung, Satz, Betrag; `sub` = eingerückte Unterposition). */
function LRow({ label, betrag, satz, bold, sub, color, topBorder }: { label: string; betrag: number; satz?: string; bold?: boolean; sub?: boolean; color?: string; topBorder?: boolean }) {
  return (
    <tr style={{ borderTop: topBorder ? "1.5px solid var(--doc-accent)" : "1px solid #ece8e2", background: bold ? "#faf8f5" : "white" }}>
      <td style={{ padding: "5px 10px", fontSize: sub ? 11 : 12, color: sub ? "#666" : "var(--doc-ink)", paddingLeft: sub ? 24 : 10 }}>{label}</td>
      <td style={{ padding: "5px 10px", fontSize: 11, color: "#888", textAlign: "right" }}>{satz || ""}</td>
      <td style={{ padding: "5px 10px", fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 400, textAlign: "right", color: color || (bold ? "var(--doc-ink)" : "#333") }}>{formatCHF(betrag)}</td>
    </tr>
  );
}

export function LohnPrint({ entry, emp, data, monatLabel, settings }: { entry: LohnEntry; emp: Employee; data: AppData; monatLabel: string; settings: Settings }) {
  const spesen = (data.expenses || []).filter(e => e.lohnEntryId === entry.id);
  // Immer den gespeicherten Snapshot verwenden — nie live emp-Werte, sonst
  // zeigt ein Reprint einer alten Abrechnung nach einer Adress-/Rollen-/
  // IBAN-Änderung des Mitarbeiters fälschlich die aktuellen statt der zum
  // Abrechnungszeitpunkt gültigen Personendaten.
  const s = entry.saetzeSnapshot || emp;
  const es = entry.empSnapshot || emp;
  // AHV-Status des Monats für die Beschriftung: unter 18 beitragsfrei, Rentner:in mit Freibetrag (vorher stand
  // «Rentnerfreibetrag» auch bei Jugendlichen und «8 %» bei der PK, wenn gar nichts abgezogen wurde)
  const status = ahvStatus(emp?.geburtsdatum, entry.monat, s.ahvRentner);
  const ahvLabel = status === "jung" ? "AHV / IV / EO (unter 18: beitragsfrei)"
    : entry.ahvBasis != null && entry.ahvBasis !== entry.bruttoTotal ? `AHV / IV / EO (auf ${formatCHF(entry.ahvBasis)}, Rentnerfreibetrag)` : "AHV / IV / EO";
  const pkAusweis = (s.pkBeitragAN ?? 0) > 0;
  const bvgSatz = pkAusweis ? "PK-Ausweis" : entry.bvg ? `${s.bvgSatz ?? 8.0}%` : "";
  const bvgLabel = !pkAusweis && !entry.bvg
    ? `BVG – Berufliche Vorsorge / PK (${status === "jung" ? "unter 18: keine Pflicht" : status === "rentner" ? "Rentner:in: keine Pflicht" : "keine Beiträge"})`
    : "BVG – Berufliche Vorsorge / PK";
  const alvSatz = status === "aktiv" ? `${s.alvSatz ?? 1.1}%` : "";


  return (
    <div style={{ fontFamily: "var(--doc-font-body)", color: "var(--doc-ink)", width: "100%", maxWidth: 760, margin: "0 auto", fontSize: 12 }}>
      {/* Header: Arbeitgeber links, Arbeitnehmer rechts */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32, paddingBottom: 20, borderBottom: "2px solid var(--doc-accent)" }}>
        <div className="doc-sender">
          <StudioLogo settings={settings} size={22} />
          <div style={{ fontSize: 11, color: "#888", marginTop: 8, lineHeight: 1.7 }}>
            {formatSenderAddress(settings).split("\n").map((l,i) => <div key={i}>{l}</div>)}
            {settings.email && <div>{settings.email}</div>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#888", marginBottom: 6 }}>LOHNABRECHNUNG</div>
          <div className="doc-heading" style={{ ...HEADING, fontSize: 22, fontWeight: 400, marginBottom: 2 }}>{es.name}</div>
          {es.role && <div style={{ fontSize: 11, color: "#888" }}>{es.role}</div>}
          {es.personalNr && <div style={{ fontSize: 11, color: "#888" }}>Personal-Nr. {es.personalNr}</div>}
          {es.ahvNr && <div style={{ fontSize: 11, color: "#888" }}>AHV-Nr. {es.ahvNr}</div>}
          {es.adresse && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{es.adresse}</div>}
          {es.ort && <div style={{ fontSize: 11, color: "#888" }}>{es.ort}</div>}
        </div>
      </div>

      {/* Periode */}
      <div style={{ display: "flex", gap: 40, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888" }}>PERIODE</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{monatLabel}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888" }}>ABRECHNUNGSDATUM</div>
          <div style={{ fontSize: 14, marginTop: 2 }}>{new Date(entry.createdAt as string).toLocaleDateString("de-CH")}</div>
        </div>
        {s.eintrittsdatum && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888" }}>EINTRITTSDATUM</div>
            <div style={{ fontSize: 14, marginTop: 2 }}>{formatDate(s.eintrittsdatum)}</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888" }}>PENSUM</div>
          <div style={{ fontSize: 14, marginTop: 2 }}>{s.pensum ?? 100}%</div>
        </div>
      </div>

      {/* Lohn-Tabelle */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid var(--doc-accent)" }}>
            <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 10, letterSpacing: "0.1em", color: "#888", fontWeight: 500 }}>POSITION</th>
            <th style={{ textAlign: "right", padding: "6px 10px", fontSize: 10, letterSpacing: "0.1em", color: "#888", fontWeight: 500 }}>SATZ</th>
            <th style={{ textAlign: "right", padding: "6px 10px", fontSize: 10, letterSpacing: "0.1em", color: "#888", fontWeight: 500 }}>BETRAG CHF</th>
          </tr>
        </thead>
        <tbody>
          <LRow label={`Monatslohn ${monatLabel}${(s.pensum ?? 100) < 100 ? ` (${s.pensum}%)` : ""}`} betrag={entry.brutto} />
          {(s.pensum ?? 100) < 100 && entry.bruttoBase != null && entry.bruttoBase !== entry.brutto && (
            <LRow label="Basis 100%" betrag={entry.bruttoBase} sub />
          )}
          {monatsAnteilNachEintritt(s.eintrittsdatum, entry.monat, s.austrittsdatum) < 1 && (
            <LRow label={s.austrittsdatum && s.austrittsdatum.slice(0, 7) === entry.monat ? `Anteilig bis Austritt ${formatDate(s.austrittsdatum)}` : `Anteilig ab Eintritt ${formatDate(s.eintrittsdatum)}`} betrag={entry.brutto} sub />
          )}
          {entry.dreizehnter !== 0 && <LRow label={entry.dreizehnterArt === "austritt" ? "13. Monatslohn (anteilig bei Austritt)" : entry.dreizehnterArt === "einmal" ? "13. Monatslohn (Auszahlung, 1/12 der Monatslöhne)" : "13. Monatslohn (1/12)"} betrag={entry.dreizehnter} sub />}
          {(entry.ueberstundenBetrag || 0) > 0 && <LRow label="Überstunden-Auszahlung" betrag={entry.ueberstundenBetrag || 0} sub />}
          {entry.bonusBetrag > 0 && <LRow label={entry.bonusBeschrieb || "Einmalzahlung / Bonus"} betrag={entry.bonusBetrag} sub />}
          {(entry.nachzahlung || 0) !== 0 && <>
            <LRow label={entry.nachzahlungBeschrieb || "Nachzahlung Lohn"} betrag={entry.nachzahlung || 0} sub />
            {(entry.nachzahlungMonate || []).map(m => (
              <LRow key={m.monat} label={`Differenz ${m.monat.slice(5)}.${m.monat.slice(0, 4)}${m.dreizehnter ? " (inkl. 13. Monatslohn)" : ""}`} betrag={m.betrag + (m.dreizehnter || 0)} sub />
            ))}
          </>}
          <LRow label="Bruttolohn" betrag={entry.bruttoTotal} bold topBorder />

          {/* Spacer */}
          <tr><td colSpan={3} style={{ padding: "4px 0", borderBottom: "none" }}><div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888", padding: "8px 10px 2px" }}>ABZÜGE ARBEITNEHMER</div></td></tr>

          <LRow label={ahvLabel} satz={status === "jung" ? "" : `${s.ahvSatz ?? 5.3}%`} betrag={-entry.ahv} sub color="#8a1a1a" />
          <LRow label="ALV – Arbeitslosenversicherung" satz={alvSatz} betrag={-entry.alv} sub color="#8a1a1a" />
          <LRow label={bvgLabel} satz={bvgSatz} betrag={-entry.bvg} sub color="#8a1a1a" />
          <LRow label="NBU – Nichtberufsunfallversicherung" satz={`${s.nbuSatz ?? 1.5}%`} betrag={-entry.nbu} sub color="#8a1a1a" />
          <LRow label="KTG – Krankentaggeldversicherung" satz={`${s.ktgSatz ?? 0.5}%`} betrag={-entry.ktg} sub color="#8a1a1a" />
          {entry.qst > 0 && <LRow label="Quellensteuer" satz={`${s.quellensteuerSatz ?? 10}%`} betrag={-entry.qst} sub color="#8a1a1a" />}

          <LRow label="Nettolohn" betrag={entry.netto} bold topBorder />
          {(entry.familienzulagen || 0) > 0 && <LRow label="Familienzulagen (Kinder-/Ausbildungszulagen)" betrag={entry.familienzulagen || 0} sub />}

          {spesen.length > 0 && <>
            <tr><td colSpan={3} style={{ padding: "4px 0", borderBottom: "none" }}><div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888", padding: "8px 10px 2px" }}>SPESENERSTATTUNG</div></td></tr>
            {spesen.map(s => <LRow key={s.id} label={`${s.category}${s.description ? " — " + s.description : ""}`} betrag={s.amount} sub />)}
          </>}

          {(entry.rundung || 0) !== 0 && <LRow label="Rundung auf 5 Rappen" betrag={entry.rundung || 0} sub />}
          <LRow label="AUSZAHLUNG TOTAL" betrag={entry.auszahlung} bold topBorder color="#2d6a4f" />
        </tbody>
      </table>

      {/* Überweisungsdetails */}
      {es.lohnIban && (
        <div style={{ padding: "14px 16px", background: "#faf8f5", border: "1px solid #e0dbd4", borderRadius: 6, marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888", marginBottom: 6 }}>ÜBERWEISUNG AUF</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{formatIban(es.lohnIban)}</div>
          {es.name && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{es.name}{es.ort ? ` · ${es.ort}` : ""}</div>}
        </div>
      )}

      {/* Arbeitgeber-Anteile (informativ, klein) */}
      <div style={{ padding: "12px 16px", border: "1px solid #e0dbd4", borderRadius: 6, marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888", marginBottom: 8 }}>ARBEITGEBERANTEILE (informativ)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            // paritätisch = AN-Abzug (ALV mit Höchstlohn), wie Buchhaltung (lohnAGBeitraege)
            { label: "AHV/IV/EO", val: lohnAGBeitraege(entry).ahvAG },
            { label: "ALV", val: lohnAGBeitraege(entry).alvAG },
            { label: "BVG/PK (AG)", val: entry.bvgAG || 0 },
            ...((entry.agFak || 0) > 0 ? [{ label: "FAK", val: entry.agFak || 0 }] : []),
            ...((entry.agVk || 0) > 0 ? [{ label: "Verwaltungskosten", val: entry.agVk || 0 }] : []),
            ...((entry.agBu || 0) > 0 ? [{ label: "UVG BU", val: entry.agBu || 0 }] : []),
            ...((entry.agKtg || 0) > 0 ? [{ label: "KTG (AG)", val: entry.agKtg || 0 }] : []),
          ].map(r => (
            <div key={r.label}>
              <div style={{ fontSize: 10, color: "#aaa" }}>{r.label}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{formatCHF(r.val)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10, color: "#aaa", borderTop: "1px solid #e0dbd4", paddingTop: 10 }}>
        Lohnabrechnung gemäss OR Art. 323b · {settings.name}{settings.mwst ? ` · ${settings.mwst}` : ""}
      </div>
    </div>
  );
}
