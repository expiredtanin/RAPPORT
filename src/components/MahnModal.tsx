// Dialog «Mahnung» für Rechnungen (Buchhaltung und Rechnungen): Zahlungserinnerung/Mahnung
// auslösen oder eine frühere nochmals drucken. Lag früher in views/Protocols.tsx.

import { formatCHF, formatDate, buildReminderLetter, localISODate } from "../utils";
import { DateInput } from "./UI";
import type { Invoice, InvoiceReminder, ViewProps } from "../types";

/**
 * Dialog «Mahnung»: neue Zahlungserinnerung/Mahnung auslösen oder eine frühere
 * nochmals drucken. «Auslösen» speichert eine `InvoiceReminder` an der Rechnung
 * (Status → «überfällig») und öffnet die Druckansicht mit dem Brieftext aus `buildReminderLetter`.
 * @param mahnMode "new" oder `reprint-<Index>` einer bisherigen Mahnung
 */
export function MahnModal({ inv, data, update, setPrintContent, onClose, mahnMode, setMahnMode, mahnSentDate, setMahnSentDate }: Pick<ViewProps, "data" | "update" | "setPrintContent"> & {
  inv: Invoice;
  onClose: () => void;
  mahnMode: string;
  setMahnMode: (mode: string) => void;
  mahnSentDate: string;
  setMahnSentDate: (date: string) => void;
}) {
  const reminders = inv.reminders || [];
  const nextNr = reminders.length + 1;
  const nextLabel = nextNr === 1 ? "Zahlungserinnerung" : `${nextNr}. Mahnung`;
  const nextColor = nextNr >= 3 ? "var(--negative)" : nextNr === 2 ? "var(--warning)" : "var(--pending)";

  const confirm = () => {
    if (mahnMode.startsWith("reprint-")) {
      const idx = parseInt(mahnMode.split("-")[1]);
      const r = reminders[idx];
      const { client, subject, body } = buildReminderLetter(inv, r.nr, r.sentDate || r.date, (data.persons||[]), data.settings);
      setPrintContent({ type: "letter", client, subject, body, settings: data.settings });
    } else {
      const { client, subject, body } = buildReminderLetter(inv, nextNr, mahnSentDate, (data.persons||[]), data.settings);
      setPrintContent({ type: "letter", client, subject, body, settings: data.settings });
      const newReminder: InvoiceReminder = { nr: nextNr, date: localISODate(), sentDate: mahnSentDate, daysPast: Math.floor((new Date(`${localISODate()}T00:00:00Z`).getTime() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86400000) };
      update("invoices", data.invoices.map(i => i.id === inv.id
        ? { ...i, status: "überfällig", reminders: [...reminders, newReminder] }
        : i
      ));
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <h2 style={{ fontFamily: "'Inter', sans-serif", fontWeight: 400, marginBottom: 6, fontSize: 22 }}>Mahnung</h2>
        <div style={{ fontSize: 12, color: "var(--text4)", marginBottom: 20 }}>Rechnung {inv.number} · {formatCHF(inv.total)}</div>
        {reminders.length > 0 && (
          <div style={{ marginBottom: 20, padding: "10px 14px", background: "var(--surface2)", borderRadius: 6, border: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 8 }}>BISHERIGE MAHNUNGEN</div>
            {reminders.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: i < reminders.length - 1 ? "1px solid var(--border2)" : "none" }}>
                <span style={{ color: "var(--text2)" }}>{i === 0 ? "Zahlungserinnerung" : `${r.nr}. Mahnung`}</span>
                <span style={{ color: "var(--text4)" }}>gesendet {formatDate(r.sentDate || r.date)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {reminders.map((r, i) => {
            const rLabel = i === 0 ? "Zahlungserinnerung" : `${r.nr}. Mahnung`;
            const rMode = `reprint-${i}`;
            return (
              <label key={i} style={{ display: "flex", gap: 12, padding: "11px 14px", borderRadius: 6, border: `1.5px solid ${mahnMode === rMode ? "var(--text)" : "var(--border)"}`, cursor: "pointer", textTransform: "none", fontSize: 13, color: "var(--text)" }}>
                <input type="radio" checked={mahnMode === rMode} onChange={() => setMahnMode(rMode)} style={{ width: "auto", marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 500 }}>{rLabel} nochmals drucken</div>
                  <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 2 }}>Gesendet am {formatDate(r.sentDate || r.date)} · kein neuer Eintrag</div>
                </div>
              </label>
            );
          })}
          <label style={{ display: "flex", gap: 12, padding: "11px 14px", borderRadius: 6, border: `1.5px solid ${mahnMode === "new" ? "var(--text)" : "var(--border)"}`, cursor: "pointer", textTransform: "none", fontSize: 13, color: "var(--text)" }}>
            <input type="radio" checked={mahnMode === "new"} onChange={() => setMahnMode("new")} style={{ width: "auto", marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: nextColor }}>{nextLabel} auslösen</div>
              <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 2 }}>Wird als neuer Eintrag gespeichert</div>
              {mahnMode === "new" && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--text4)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>Sendedatum</label>
                  <DateInput value={mahnSentDate} onChange={e => setMahnSentDate(e.target.value)} style={{ flex: 1, height: 32, fontSize: 12 }} />
                </div>
              )}
            </div>
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={confirm} style={{ background: mahnMode === "new" ? nextColor : "#2a2a22" }}>
            ✉ Drucken{mahnMode === "new" ? " & speichern" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
