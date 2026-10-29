// Startwerte des Rechnungsformulars aus dem Dialog «Neue Rechnung» (Projekt, Offerte oder frei):
// Positionen, Notizen und Zeiteintrags-Auswahl für Teil-, Akonto- und Schlussrechnungen.

import { SIA_PHASES } from "../../constants";
import { generateId, localISODate } from "../../utils";
import type { AppData, Invoice, InvoiceItem, TimeEntry } from "../../types";
import type { EntrySelections, InvoiceForm, NewInvoiceState } from "./invoiceHelpers";

/**
 * Baut das Formular für eine neue Rechnung aus dem Dialogzustand `ni`. `null` = Projekt/Offerte nicht
 * gefunden (Dialog bleibt offen); `{ form: null }` = nichts vorzubefüllen.
 */
export const buildNewInvoiceForm = (
  ni: NewInvoiceState,
  data: AppData,
  invoices: Invoice[],
  number: string,
  openEntriesForProject: (projectId?: string) => TimeEntry[],
): { form: InvoiceForm | null } | null => {
  let form: InvoiceForm | null = null;
    const todayStr = localISODate();
    const due = new Date(); due.setDate(due.getDate() + 30);
    const base = {
      number, date: todayStr, dueDate: localISODate(due),
      mwst: true, mwstRate: data.settings.mwstRate,
      notes: "Zahlbar innert 30 Tagen netto.", status: "entwurf",
      discountType: "none", discountValue: 0, discountLabel: "Rabatt",
    };

    if (ni.tab === "frei") {
      form = ({ ...base, clientId: "", projectId: "", entrySelections: {}, items: [{ id: generateId(), desc: "", qty: 1, price: 0, discount: 0 }] });
    } else if (ni.tab === "projekt") {
      const proj = data.projects.find(p => p.id === ni.projectId);
      if (!proj) return null;
      const bType = proj.billingType || proj.type;
      const projBudget = proj.budget || proj.budgetAmount || 0;
      if (ni.mode === "teilrechnung") {
        const entries = openEntriesForProject(proj.id);
        const entrySelections: EntrySelections = {};
        entries.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
        const hours = Math.round(entries.reduce((s, e) => s + e.minutes, 0) / 60 * 100) / 100;
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung – Architektur-/Grafikleistungen – ${proj.name}`, qty: hours, price: proj.hourlyRate || 0, discount: 0 }] });
      } else if (ni.mode === "teilrechnung-percent") {
        const amt = projBudget * (ni.pct / 100);
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung – ${proj.name} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }] });
      } else if (ni.mode === "teilrechnung-amount") {
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung – ${proj.name}`, qty: 1, price: ni.amt, discount: 0 }] });
      } else if (ni.mode === "akonto-percent") {
        const amt = projBudget * (ni.pct / 100);
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung – ${proj.name} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }] });
      } else if (ni.mode === "akonto-amount") {
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung – ${proj.name}`, qty: 1, price: ni.amt, discount: 0 }] });
      } else if (ni.mode === "akonto-stunden") {
        const entries = openEntriesForProject(proj.id).filter(e => (e.date || "") <= todayStr);
        const entrySelections: EntrySelections = {};
        entries.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
        const hours = Math.round(entries.reduce((s, e) => s + e.minutes, 0) / 60 * 100) / 100;
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung – ${proj.name}`, qty: hours, price: proj.hourlyRate || 0, discount: 0 }] });
      } else if (ni.mode === "phase") {
        const ph = (proj.phasesBudget || []).find(p => p.id === ni.phaseId);
        const phInfo = SIA_PHASES.find(p => p.id === ni.phaseId);
        const amt = Math.round((ph?.hours || 0) * (proj.hourlyRate || 0) * 100) / 100;
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "teilrechnung",
          items: [{ id: generateId(), desc: `Teilrechnung ${phInfo?.label || ni.phaseId} – ${proj.name}`, qty: 1, price: amt, discount: 0 }] });
      } else if (ni.mode === "akonto-phase") {
        const ph = (proj.phasesBudget || []).find(p => p.id === ni.phaseId);
        const phInfo = SIA_PHASES.find(p => p.id === ni.phaseId);
        const amt = Math.round((ph?.hours || 0) * (proj.hourlyRate || 0) * 100) / 100;
        form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "akonto",
          items: [{ id: generateId(), desc: `Akontorechnung ${phInfo?.label || ni.phaseId} – ${proj.name}`, qty: 1, price: amt, discount: 0 }] });
      } else {
        // schluss
        if (bType === "stundensatz") {
          const entries = openEntriesForProject(proj.id).filter(e => (e.date || "") <= todayStr);
          const entrySelections: EntrySelections = {};
          entries.forEach(e => { entrySelections[e.id] = { selected: true, billedMinutes: e.minutes }; });
          const hours = Math.round(entries.reduce((s, e) => s + e.minutes, 0) / 60 * 100) / 100;
          form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections, invoiceKind: "schluss",
            items: [{ id: generateId(), desc: `Schlussrechnung – ${proj.name}`, qty: hours, price: proj.hourlyRate || 0, discount: 0 }] });
        } else {
          // Pauschal-Schluss: Gesamthonorar ausweisen, alle bisherigen
          // Zahlungen abziehen. Denylist statt Allowlist auf invoiceKind:
          // eine über das Projekt-Autofill an eine "Freie Rechnung"
          // gehängte Teilzahlung hat invoiceKind==="" (nie klassifiziert)
          // und wurde von einer Akonto/Teilrechnung-Allowlist nicht erfasst
          // — reales Doppelverrechnungsrisiko (live nachgestellt: CHF 8'000
          // bereits gesendete "freie" Rechnung wurde bei der Schlussrechnung
          // nicht abgezogen). Nur eine vorherige Schlussrechnung selbst
          // ausschliessen.
          const akontoInvs = invoices.filter(i => i.projectId === proj.id && i.invoiceKind !== "schluss" && i.status !== "entwurf");
          const akontoTotal = akontoInvs.reduce((s, i) => s + (i.subAfterDisc ?? i.sub ?? 0), 0);
          const schlussItems = [
            { id: generateId(), desc: `Pauschalhonorar – ${proj.name}`, qty: 1, price: projBudget, discount: 0 },
            ...(akontoTotal > 0 ? [{ id: generateId(), desc: `Abzgl. bisherige Akonto-/Teilzahlungen (${akontoInvs.map(i => i.number).filter(Boolean).join(", ")})`, qty: 1, price: -akontoTotal, discount: 0 }] : []),
          ];
          const notes = akontoTotal > 0
            ? `Schlussrechnung gemäss Honorarvereinbarung.\nBisherige Akonto-/Teilzahlungen:\n${akontoInvs.map(i => `  – ${i.number}: CHF ${(i.subAfterDisc ?? i.sub ?? 0).toFixed(2)}`).join("\n")}\n\nZahlbar innert 30 Tagen netto.`
            : "Zahlbar innert 30 Tagen netto.";
          form = ({ ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {}, invoiceKind: "schluss", items: schlussItems, notes });
        }
      }
    } else if (ni.tab === "offerte") {
      const q = (data.quotes || []).find(x => x.id === ni.quoteId);
      if (!q) return null;
      // Akonti/Teilrechnungen können auch über den Projekt-Tab entstanden sein
      // (setzen projectId statt quoteId) — sonst würde eine Schlussrechnung
      // über den Offerte-Tab sie nicht abziehen und den vollen Betrag statt
      // des Restbetrags in Rechnung stellen.
      const existing = (invoices).filter(i => i.quoteId === q.id || (q.projectId && i.projectId === q.projectId));
      let items: InvoiceItem[], invoiceKind = "akonto";
      if (ni.mode === "schluss") {
        invoiceKind = "schluss";
        // Denylist statt Allowlist: eine über das Projekt-Autofill
        // verknüpfte "freie" Rechnung hat invoiceKind==="" und würde von
        // einer Akonto/Teilrechnung-Allowlist nicht erfasst — reales
        // Doppelverrechnungsrisiko (live nachgestellt).
        const akontoInvs = existing.filter(i => i.invoiceKind !== "schluss" && i.status !== "entwurf");
        const akontoTotal = akontoInvs.reduce((s, i) => s + (i.subAfterDisc ?? i.sub ?? 0), 0);
        items = [
          { id: generateId(), desc: `Honorar gemäss Offerte ${q.number}`, qty: 1, price: q.sub || 0, discount: 0 },
          ...(akontoTotal > 0 ? [{ id: generateId(), desc: `Abzgl. bisherige Akonto-/Teilzahlungen (${akontoInvs.map(i => i.number).filter(Boolean).join(", ")})`, qty: 1, price: -akontoTotal, discount: 0 }] : []),
        ];
      } else if (ni.mode === "teilrechnung-percent") {
        invoiceKind = "teilrechnung";
        const amt = (q.sub || 0) * (ni.pct / 100);
        items = [{ id: generateId(), desc: `Teilrechnung gemäss Offerte ${q.number} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }];
      } else if (ni.mode === "teilrechnung-amount") {
        invoiceKind = "teilrechnung";
        items = [{ id: generateId(), desc: `Teilrechnung gemäss Offerte ${q.number}`, qty: 1, price: ni.amt, discount: 0 }];
      } else if (ni.mode === "akonto-percent") {
        const amt = (q.sub || 0) * (ni.pct / 100);
        items = [{ id: generateId(), desc: `Akontorechnung gemäss Offerte ${q.number} (${ni.pct.toFixed(1)}%)`, qty: 1, price: Math.round(amt * 100) / 100, discount: 0 }];
      } else {
        items = [{ id: generateId(), desc: `Akontorechnung gemäss Offerte ${q.number}`, qty: 1, price: ni.amt, discount: 0 }];
      }
      let notes = `Gemäss Offerte ${q.number}. Zahlbar innert 30 Tagen netto.`;
      if (invoiceKind === "schluss" && existing.filter(i => i.invoiceKind !== "schluss").length > 0) {
        const akontoInvs = existing.filter(i => i.invoiceKind !== "schluss" && i.status !== "entwurf");
        notes = `Schlussrechnung gemäss Offerte ${q.number}.\nBisherige Akonto-/Teilzahlungen:\n${akontoInvs.map(i => `  – ${i.number}: CHF ${(i.subAfterDisc ?? i.sub ?? 0).toFixed(2)}`).join("\n")}\n\nZahlbar innert 30 Tagen netto.`;
      }
      form = ({ ...base, clientId: q.clientId || "", projectId: q.projectId || "", quoteId: q.id, entrySelections: {}, invoiceKind, items, notes });
    }
  return { form };
};
