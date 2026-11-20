// Startwerte des Rechnungsformulars aus dem Dialog «Neue Rechnung» (Projekt, Offerte oder frei):
// Positionen, Notizen und Zeiteintrags-Auswahl für Teil-, Akonto- und Schlussrechnungen.
// Die Dialog-Vorschau (NewInvoiceModal) rechnet mit genau diesem Formular — Vorschau und Formular
// können also nicht auseinanderlaufen.

import { SIA_PHASES } from "../../constants";
import { generateId, invoiceNet, localISODate, projectFee, roundCHF } from "../../utils";
import type { AppData, Invoice, InvoiceItem, TimeEntry } from "../../types";
import { invoicesForQuote, phaseInvoiceAmount, selectAllEntries } from "./invoiceHelpers";
import type { InvoiceForm, NewInvoiceState } from "./invoiceHelpers";

/** Abzugszeile und Notiz für bisherige Akonto-/Teilrechnungen einer Schlussrechnung (leer, wenn nichts abzuziehen ist). */
const deduction = (prior: Invoice[], intro: string) => {
  const total = roundCHF(prior.reduce((s, i) => s + invoiceNet(i), 0));
  if (!(Math.abs(total) > 0)) return { items: [] as InvoiceItem[], notes: "Zahlbar innert 30 Tagen netto." };
  return {
    items: [{ id: generateId(), desc: `Abzgl. bisherige Akonto-/Teilrechnungen (${prior.map(i => i.number).filter(Boolean).join(", ")})`, qty: 1, price: -total, discount: 0 }],
    notes: `${intro}\nBisherige Akonto-/Teilrechnungen (netto):\n${prior.map(i => `  – ${i.number}: CHF ${invoiceNet(i).toFixed(2)}`).join("\n")}\n\nZahlbar innert 30 Tagen netto.`,
  };
};

/**
 * Baut das Formular für eine neue Rechnung aus dem Dialogzustand `ni`. `null` = Projekt/Offerte nicht
 * gefunden (Dialog bleibt offen); `{ form: null }` = nichts vorzubefüllen.
 *
 * Schlussrechnungen ziehen die bisherigen gestellten Rechnungen (ohne Entwürfe; eine frühere
 * Schlussrechnung zählt mit, sonst würde eine zweite — z.B. nach einem Nachtrag — den schon
 * schlussverrechneten Betrag nochmals stellen) netto nach Rabatt ab: Pauschal alle des Projekts; Stundensatz nur die nicht nach
 * Stunden gestellten (deren Zeiteinträge sind schon verrechnet und fehlen in den offenen Stunden);
 * aus einer Offerte nur die Rechnungen dieser Offerte (`invoicesForQuote`).
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
  const isPrior = (i: Invoice) => i.status !== "entwurf";

  if (ni.tab === "frei") {
    form = ({ ...base, clientId: "", projectId: "", entrySelections: {}, items: [{ id: generateId(), desc: "", qty: 1, price: 0, discount: 0 }] });
  } else if (ni.tab === "projekt") {
    const proj = data.projects.find(p => p.id === ni.projectId);
    if (!proj) return null;
    const bType = proj.billingType || proj.type;
    const fee = projectFee(proj);
    const head = { ...base, clientId: proj.clientId || "", projectId: proj.id, entrySelections: {} };
    /** Formular nach Stunden: alle offenen Einträge (bis heute, falls `untilToday`) gewählt, Zeile 1 folgt der Auswahl. */
    const fromHours = (kind: string, desc: string, untilToday: boolean): InvoiceForm => {
      const entries = openEntriesForProject(proj.id).filter(e => !untilToday || (e.date || "") <= todayStr);
      const hours = Math.round(entries.reduce((s, e) => s + e.minutes, 0) / 60 * 100) / 100;
      return { ...head, entrySelections: selectAllEntries(entries), hoursFromEntries: true, invoiceKind: kind,
        items: [{ id: generateId(), desc, qty: hours, price: proj.hourlyRate || 0, discount: 0 }] };
    };
    const single = (kind: string, desc: string, price: number): InvoiceForm =>
      ({ ...head, invoiceKind: kind, items: [{ id: generateId(), desc, qty: 1, price: Math.round(price * 100) / 100, discount: 0 }] });
    const phaseLabel = SIA_PHASES.find(p => p.id === ni.phaseId)?.label || ni.phaseId;

    if (ni.mode === "teilrechnung") {
      form = fromHours("teilrechnung", `Teilrechnung – Architektur-/Grafikleistungen – ${proj.name}`, false);
    } else if (ni.mode === "teilrechnung-percent") {
      form = single("teilrechnung", `Teilrechnung – ${proj.name} (${ni.pct.toFixed(1)}%)`, fee * (ni.pct / 100));
    } else if (ni.mode === "teilrechnung-amount") {
      form = single("teilrechnung", `Teilrechnung – ${proj.name}`, ni.amt);
    } else if (ni.mode === "akonto-percent") {
      form = single("akonto", `Akontorechnung – ${proj.name} (${ni.pct.toFixed(1)}%)`, fee * (ni.pct / 100));
    } else if (ni.mode === "akonto-amount") {
      form = single("akonto", `Akontorechnung – ${proj.name}`, ni.amt);
    } else if (ni.mode === "akonto-stunden") {
      form = fromHours("akonto", `Akontorechnung – ${proj.name}`, true);
    } else if (ni.mode === "phase" || ni.mode === "akonto-phase") {
      const amt = phaseInvoiceAmount(proj, ni.phaseId || "", data.quotes || [], data.settings.roles);
      form = ni.mode === "phase"
        ? single("teilrechnung", `Teilrechnung ${phaseLabel} – ${proj.name}`, amt)
        : single("akonto", `Akontorechnung ${phaseLabel} – ${proj.name}`, amt);
    } else if (bType === "stundensatz") {
      // Schluss nach Stunden: offene Stunden bis heute, abzüglich Akonti/Teilrechnungen, die NICHT nach
      // Stunden gestellt wurden (Betrag, %, Phase) — sonst würden diese doppelt verrechnet.
      form = fromHours("schluss", `Schlussrechnung – ${proj.name}`, true);
      const hourBased = new Set(data.timeEntries.map(e => e.invoiceId).filter(Boolean));
      const prior = invoices.filter(i => i.projectId === proj.id && isPrior(i) && !hourBased.has(i.id));
      const d = deduction(prior, "Schlussrechnung nach Aufwand.");
      form = { ...form, items: [...form.items, ...d.items], notes: d.notes };
    } else {
      // Pauschal-Schluss: Gesamthonorar ausweisen, alle bisherigen Zahlungen abziehen. Denylist statt
      // Allowlist auf invoiceKind: eine über das Projekt-Autofill an eine «Freie Rechnung» gehängte
      // Teilzahlung hat invoiceKind === "" und muss trotzdem abgezogen werden.
      const prior = invoices.filter(i => i.projectId === proj.id && isPrior(i));
      const d = deduction(prior, "Schlussrechnung gemäss Honorarvereinbarung.");
      form = { ...head, invoiceKind: "schluss", notes: d.notes,
        items: [{ id: generateId(), desc: `Pauschalhonorar – ${proj.name}`, qty: 1, price: fee, discount: 0 }, ...d.items] };
    }
  } else if (ni.tab === "offerte") {
    const q = (data.quotes || []).find(x => x.id === ni.quoteId);
    if (!q) return null;
    const qBase = { ...base, mwst: q.mwst !== false, mwstRate: q.mwstRate ?? data.settings.mwstRate };
    const pctAmt = Math.round((q.sub || 0) * (ni.pct / 100) * 100) / 100;
    let items: InvoiceItem[], invoiceKind = "akonto";
    let notes = `Gemäss Offerte ${q.number}. Zahlbar innert 30 Tagen netto.`;
    if (ni.mode === "schluss") {
      invoiceKind = "schluss";
      const prior = invoicesForQuote(q, invoices, data.projects).filter(isPrior);
      const d = deduction(prior, `Schlussrechnung gemäss Offerte ${q.number}.`);
      items = [{ id: generateId(), desc: `Honorar gemäss Offerte ${q.number}`, qty: 1, price: q.sub || 0, discount: 0 }, ...d.items];
      if (d.items.length) notes = d.notes;
    } else if (ni.mode === "teilrechnung-percent") {
      invoiceKind = "teilrechnung";
      items = [{ id: generateId(), desc: `Teilrechnung gemäss Offerte ${q.number} (${ni.pct.toFixed(1)}%)`, qty: 1, price: pctAmt, discount: 0 }];
    } else if (ni.mode === "teilrechnung-amount") {
      invoiceKind = "teilrechnung";
      items = [{ id: generateId(), desc: `Teilrechnung gemäss Offerte ${q.number}`, qty: 1, price: ni.amt, discount: 0 }];
    } else if (ni.mode === "akonto-percent") {
      items = [{ id: generateId(), desc: `Akontorechnung gemäss Offerte ${q.number} (${ni.pct.toFixed(1)}%)`, qty: 1, price: pctAmt, discount: 0 }];
    } else {
      items = [{ id: generateId(), desc: `Akontorechnung gemäss Offerte ${q.number}`, qty: 1, price: ni.amt, discount: 0 }];
    }
    form = ({ ...qBase, clientId: q.clientId || "", projectId: q.projectId || "", quoteId: q.id, entrySelections: {}, invoiceKind, items, notes });
  }
  return { form };
};
