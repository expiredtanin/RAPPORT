// Kontakte: Stammdaten aller Kontakte (Auftraggeber, Fachplaner, Behörden, Auslober …) mit ihren
// Ansprechpartnern. Ein Kontakt im Datenmodell (`data.persons`, Name historisch) ist meist eine
// Firma; die Menschen darin stehen in `contacts`. Es gibt keine Unterscheidung Auftraggeber/Partner
// mehr: jeder Kontakt ist überall auswählbar, beim Erstellen wird nur eine Kategorie
// (`Person.category`: Person, Unternehmer, Öffentliche, Auslober, WBW-Beteiligte) gewählt.
//
// Zwei Listenansichten (Firmen / Einzelpersonen) mit Suche und Gruppierung,
// eine Detailansicht pro Firma (`FirmaDetail`: Projekte, Rechnungen, Offerten,
// Protokolle, Ansprechpartner) und zwei Dialoge (Firma, Ansprechpartner).
// Gelöschte Firmen lassen Verweise in Projekten und Rechnungen bestehen
// (dort bleibt dann nur die Id).

import React, { useState, useEffect } from "react";
import { generateId, formatCHF, formatDate, contactCategory, personReferences } from "../utils";
import { useConfirm } from "../hooks/useConfirm";
import { isCloudBackend } from "../storage/adapter";
import { CONTACT_CATEGORIES, CONTACT_TYPES, DEFAULT_LEAD_SOURCES } from "../constants";
import { clientRevenue, lastContact, referredLeadCount, referredRevenue } from "../crm";
import ActivityLog from "../components/ActivityLog";
import { Header, Modal, FormField, StatusBadge, RowMenu, EmptyState, TableToolbar } from "../components/UI";
import { changeWithUndo, removeWithUndo } from "../undo";
import type { AppData, Contact, ContactCategory, Person, UpdateFn, ViewProps } from "../types";

/** Formular einer Firma; die `_haupt*`-Felder gibt es nur beim Neuanlegen (erster Ansprechpartner). */
type FirmForm = Partial<Person> & { _hauptName?: string; _hauptPosition?: string; _hauptPhone?: string; _hauptEmail?: string; /** Tags als kommagetrennter Text im Formular */ _tags?: string };
type PersonForm = { firmaId: string; name: string; position: string; phone: string; email: string };
/** Ansprechpartner mit Angaben seiner Firma (für die Einzelpersonen-Liste). */
type FlatContact = Contact & { _firmaId: string; _firmaName: string; _firmaType: string };
type Group<T> = { key: string; label: string | null; items: T[] };

const emptyFirm: Omit<Person, "id"> = {
  name: "", type: "", street: "", zip: "", city: "", country: "CH",
  email: "", phone: "", website: "", note: "", contacts: [],
  honorarOffers: [], category: "unternehmer",
  // Altflags: filtert nichts mehr, wird aber weiter geschrieben (Cloud-Zuordnung, ältere Versionen)
  isAuftraggeber: true, isPartner: true,
};

const RoleBadge = ({ label, color, bg }: { label: string; color: string; bg: string }) => (
  <span style={{ fontSize: 10, fontWeight: 600, color, background: bg, padding: "2px 10px", borderRadius: 20, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{label}</span>
);

/** Abzeichen der Kontakt-Kategorie; nichts bei Altdaten ohne Kategorie. */
const CategoryBadge = ({ person }: { person: Person }) => {
  const c = CONTACT_CATEGORIES.find(x => x.id === contactCategory(person));
  return c ? <RoleBadge label={c.label} color={c.color} bg={c.bg} /> : null;
};

const SectionHead = ({ label }: { label: string }) => (
  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text5)", marginTop: 20, marginBottom: 12, paddingTop: 14, borderTop: "1px solid var(--border)" }}>{label}</div>
);


// ── Detail View ────────────────────────────────────────────────────────────────
/** Zeile «Label: Wert» in der Firmen-Detailansicht; ohne Wert wird nichts angezeigt. */
function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: "var(--text4)", width: 100, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

function FirmaDetail({ firma, data, update, onBack, onEdit, onAddPerson, onEditPerson, onDeletePerson }: {
  firma: Person; data: AppData; update: UpdateFn; onBack: () => void; onEdit: () => void; onAddPerson: () => void;
  onEditPerson: (firmaId: string, personId: string) => void; onDeletePerson: (firmaId: string, personId: string) => void;
  onDeleteFirm?: (id: string) => void;
}) {
  const invoices  = (data.invoices  || []).filter(i => i.clientId  === firma.id);
  const quotes    = (data.quotes    || []).filter(q => q.clientId  === firma.id);
  const asClient  = (data.projects  || []).filter(p => p.clientId  === firma.id);
  const asPartner = (data.projects  || []).filter(p => (p.projectContacts || []).some(pc => pc.contactId === firma.id));
  const allProjects = [...new Map([...asClient, ...asPartner].map(p => [p.id, p])).values()]
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));

  const protocols = (data.protocols || []).filter(proto =>
    asPartner.some(p => p.id === proto.projectId)
  ).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // Ohne feste Rolle: KPIs und Abschnitte richten sich danach, was der Kontakt tatsächlich hat.
  const isClientLike = asClient.length > 0 || invoices.length > 0 || quotes.length > 0 || asPartner.length === 0;
  const addr = [firma.street, [firma.zip, firma.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <div>
      {/* Kopf als Band wie bei den Projekten */}
      <header className="page-head">
        <button className="btn btn-quiet btn-sm" onClick={onBack} style={{ marginLeft: -10, marginBottom: 6 }}><span className="msr" style={{ fontSize: 16 }}>arrow_back</span>Alle Kontakte</button>
        <div className="page-crumb" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <CategoryBadge person={firma} />
          {firma.type && <span>{firma.type}</span>}
        </div>
        <div className="page-head-row">
          <h1>{firma.name}</h1>
          <div className="page-actions">
            {firma.email && <a className="btn btn-ghost" href={`mailto:${firma.email}`}><span className="msr" style={{ fontSize: 17 }}>mail</span>E-Mail</a>}
            {firma.phone && <a className="btn btn-ghost" href={`tel:${firma.phone.replace(/\s+/g, "")}`}><span className="msr" style={{ fontSize: 17 }}>call</span>Anrufen</a>}
            <button className="btn btn-ghost" onClick={onEdit}><span className="msr" style={{ fontSize: 17 }}>edit</span>Bearbeiten</button>
          </div>
        </div>
        {addr && <div className="page-sub">{addr}</div>}
      </header>

      {/* Kennzahlen als ein Band (wie im Projekt-Arbeitsraum) */}
      {(() => {
        const open = invoices.filter(i => i.status === "gesendet" || i.status === "überfällig").reduce((s, i) => s + (i.total || 0), 0);
        const last = lastContact(data, firma.id);
        const figs: { label: string; value: string; sub?: string; tone?: string }[] = [
          { label: "Projekte", value: String(allProjects.length), sub: isClientLike ? (asPartner.length ? `${asPartner.length} als Beteiligte` : undefined) : `${protocols.length} Protokolle` },
          ...(isClientLike ? [
            { label: "Umsatz (netto)", value: formatCHF(clientRevenue(data, firma.id)).replace(/^CHF\s*/u, ""), sub: `${invoices.length} Rechnungen · ${quotes.length} Offerten` },
            { label: "Offen", value: formatCHF(open).replace(/^CHF\s*/u, ""), sub: open > 0 ? "CHF ausstehend" : "nichts ausstehend", tone: open > 0 ? "warn" : undefined },
          ] : [
            { label: "Ansprechpartner", value: String((firma.contacts || []).length) },
          ]),
          ...(referredLeadCount(data, firma.id) > 0 ? [{ label: "Vermittelt", value: String(referredLeadCount(data, firma.id)), sub: formatCHF(referredRevenue(data, firma.id)) }] : []),
          { label: "Letzter Kontakt", value: last ? formatDate(last) : "—", sub: last ? undefined : "noch nichts erfasst" },
        ];
        return (
          <div className="ws-figs" style={{ gridTemplateColumns: `repeat(${figs.length}, minmax(0, 1fr))`, marginBottom: 22 }}>
            {figs.map(f => <div key={f.label}><small>{f.label}</small><strong className={`num${f.tone ? ` ${f.tone}` : ""}`}>{f.value}</strong>{f.sub && <em>{f.sub}</em>}</div>)}
          </div>
        );
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }} className="responsive-grid-2">
        <div>
          {/* Kontaktverlauf */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 12 }}>KONTAKTVERLAUF</div>
            <ActivityLog data={data} update={update} personId={firma.id} />
          </div>
          {/* Projekte */}
          {allProjects.length > 0 && (
            <div className="card" style={{ padding: 0, marginBottom: 20 }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border2)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>PROJEKTE</div>
              <table style={{ width: "100%" }}>
                <tbody>
                  {allProjects.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontSize: 11, color: "var(--text4)", width: 80 }}>{p.number || "—"}</td>
                      <td><strong style={{ fontSize: 13 }}>{p.name}</strong></td>
                      <td style={{ fontSize: 11, color: "var(--text4)" }}>
                        {asClient.find(x => x.id === p.id) && <span style={{ marginRight: 6, color: "var(--info)" }}>Auftraggeber</span>}
                        {asPartner.find(x => x.id === p.id) && <span style={{ color: "var(--positive)" }}>Beteiligt</span>}
                      </td>
                      <td style={{ textAlign: "right" }}><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Rechnungen — wenn der Kontakt als Kunde vorkommt */}
          {isClientLike && (
            <div className="card" style={{ padding: 0, marginBottom: 20 }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border2)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>RECHNUNGEN</div>
              {invoices.length === 0 ? (
                <div style={{ padding: "24px 16px", fontSize: 12, color: "var(--text5)" }}>Keine Rechnungen.</div>
              ) : (
                <table style={{ width: "100%" }}>
                  <tbody>
                    {[...invoices].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(inv => (
                      <tr key={inv.id}>
                        <td style={{ fontSize: 11, color: "var(--text4)", width: 90 }}>{inv.number || "—"}</td>
                        <td style={{ fontSize: 12 }}>{formatDate(inv.date)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, fontSize: 13 }}>{formatCHF(inv.total || 0)}</td>
                        <td style={{ textAlign: "right", width: 90 }}><StatusBadge status={inv.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Offerten — wenn der Kontakt als Kunde vorkommt */}
          {isClientLike && (
            <div className="card" style={{ padding: 0, marginBottom: 20 }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border2)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>OFFERTEN</div>
              {quotes.length === 0 ? (
                <div style={{ padding: "24px 16px", fontSize: 12, color: "var(--text5)" }}>Keine Offerten.</div>
              ) : (
                <table style={{ width: "100%" }}>
                  <tbody>
                    {[...quotes].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(q => (
                      <tr key={q.id}>
                        <td style={{ fontSize: 11, color: "var(--text4)", width: 90 }}>{q.number || "—"}</td>
                        <td style={{ fontSize: 12 }}>{formatDate(q.date)}</td>
                        <td style={{ fontSize: 11, color: "var(--text4)" }}>{q.mode === "sia" ? "SIA 102" : q.mode === "manual" ? "Manuell" : "Frei"}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, fontSize: 13 }}>{formatCHF(q.sub || 0)}</td>
                        <td style={{ textAlign: "right", width: 90 }}><StatusBadge status={q.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Protokolle — wenn der Kontakt an Projekten beteiligt ist */}
          {protocols.length > 0 && (
            <div className="card" style={{ padding: 0, marginBottom: 20 }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border2)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>PROTOKOLLE</div>
              <table style={{ width: "100%" }}>
                <tbody>
                  {protocols.slice(0, 10).map(proto => {
                    const proj = (data.projects || []).find(p => p.id === proto.projectId);
                    return (
                      <tr key={proto.id}>
                        <td style={{ fontSize: 11, color: "var(--text4)", width: 80 }}>{formatDate(proto.date)}</td>
                        <td style={{ fontSize: 12 }}>{proto.type || "Protokoll"}{proto.nummer ? ` #${proto.nummer}` : ""}</td>
                        <td style={{ fontSize: 11, color: "var(--text4)" }}>{proj?.name || ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column: Stammdaten + Ansprechpartner */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)", marginBottom: 12 }}>STAMMDATEN</div>
            <InfoRow label="E-Mail" value={firma.email} />
            <InfoRow label="Telefon" value={firma.phone} />
            <InfoRow label="Website" value={firma.website} />
            <InfoRow label="Adresse" value={addr} />
            {firma.note && <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)", borderTop: "1px solid var(--border2)", paddingTop: 10 }}>{firma.note}</div>}
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text4)" }}>ANSPRECHPARTNER</div>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={onAddPerson}>+ Person</button>
            </div>
            {(firma.contacts || []).length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text5)" }}>Keine Ansprechpartner erfasst.</div>
            ) : (firma.contacts || []).map(c => (
              <div key={c.id} style={{ borderBottom: "1px solid var(--border2)", paddingBottom: 10, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    {c.position && <div style={{ fontSize: 11, color: "var(--text4)" }}>{c.position}</div>}
                    {c.email    && <div style={{ fontSize: 11, color: "var(--text4)" }}>{c.email}</div>}
                    {c.phone    && <div style={{ fontSize: 11, color: "var(--text4)" }}>{c.phone}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 7px" }} onClick={() => onEditPerson(firma.id, c.id)}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                    <button className="btn-icon danger" title="Entfernen" aria-label="Entfernen" onClick={() => onDeletePerson(firma.id, c.id)}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main View ──────────────────────────────────────────────────────────────────
declare global {
  interface Window {
    /** Einmaliger Hinweis von anderen Ansichten (z.B. CRM-Auswertung): öffnet beim Betreten die Detailansicht dieses Kontakts. */
    __openContactId?: string | null;
  }
}

export default function Persons({ data, update, modal, setModal }: Pick<ViewProps, "data" | "update" | "saveAll" | "setView" | "modal" | "setModal">) {
  const persons  = data.persons  || [];
  const projects = data.projects || [];

  const [selectedId, setSelectedId] = useState<string | null>(() => { const id = window.__openContactId || null; window.__openContactId = null; return id; });
  const [search,     setSearch]     = useState("");
  const [ansicht,    setAnsicht]    = useState("firmen");
  const [groupBy,    setGroupBy]    = useState("alpha");

  const [firmModal,   setFirmModal]   = useState<{ isNew?: boolean; id?: string } | null>(null);
  const [firmForm,    setFirmForm]    = useState<FirmForm>({});
  const [personModal, setPersonModal] = useState<{ isNew?: boolean; firmaId?: string; personId?: string } | null>(null);
  const [personForm,  setPersonForm]  = useState<Partial<PersonForm>>({});

  // Befehlspalette (App.tsx): Kontakt öffnen (auch über einen Ansprechpartner gefunden)
  useEffect(() => {
    if (modal?.type !== "openPerson") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalige Übergabe aus der Befehlspalette
    setSelectedId(persons.some(x => x.id === modal.id) ? modal.id as string : null);
    setModal(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nur auf neue Aufträge reagieren
  }, [modal?.type, modal?.id]);

  // ── Counts ─────────────────────────────────────────────────────────────────
  const allPersonsFlat: FlatContact[] = persons.flatMap(firma =>
    (firma.contacts || []).map(c => ({ ...c, _firmaId: firma.id, _firmaName: firma.name, _firmaType: firma.type }))
  );

  // ── Filtering ──────────────────────────────────────────────────────────────
  const q = search.toLowerCase();

  const filteredFirmen = persons.filter(p => {
    if (ansicht.startsWith("cat:") && contactCategory(p) !== ansicht.slice(4)) return false;
    if (q) {
      const addr = [p.street, p.zip, p.city].filter(Boolean).join(" ");
      const contactNames = (p.contacts || []).map(c => c.name).join(" ");
      if (![p.name, p.type, p.email, addr, contactNames].some(v => v?.toLowerCase().includes(q))) return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, "de"));

  const filteredPersons = allPersonsFlat.filter(c => {
    if (!q) return true;
    return [c.name, c.position, c.email, c.phone, c._firmaName].some(v => v?.toLowerCase().includes(q));
  }).sort((a, b) => a.name.localeCompare(b.name, "de"));

  const showPersonsView = ansicht === "personen";

  // ── Grouping ───────────────────────────────────────────────────────────────
  const groupedFirmen: Group<Person>[] = (() => {
    if (groupBy === "none") return [{ key: "_all", label: null, items: filteredFirmen }];
    if (groupBy === "alpha") {
      const g: Record<string, Person[]> = {};
      filteredFirmen.forEach(p => { const k = p.name[0]?.toUpperCase() || "#"; (g[k] = g[k] || []).push(p); });
      return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([k, items]) => ({ key: k, label: k, items }));
    }
    if (groupBy === "type") {
      const g: Record<string, Person[]> = {};
      filteredFirmen.forEach(p => {
        const k = CONTACT_CATEGORIES.find(c => c.id === contactCategory(p))?.label || "Ohne Kategorie";
        (g[k] = g[k] || []).push(p);
      });
      const order = CONTACT_CATEGORIES.map(c => c.label);
      return Object.entries(g).sort((a, b) => {
        const oa = order.indexOf(a[0]), ob = order.indexOf(b[0]);
        if (oa !== -1 && ob !== -1) return oa - ob;
        if (oa !== -1) return -1; if (ob !== -1) return 1;
        return a[0].localeCompare(b[0]);
      }).map(([k, items]) => ({ key: k, label: k, items }));
    }
    // Fallback: groupBy kann kurzzeitig einen Wert enthalten, der zur
    // gerade aktiven Ansicht nicht (mehr) passt (z.B. "firma" während
    // ansicht="firmen") — ohne Fallback käme hier undefined statt eines
    // Arrays zurück und der nachfolgende .map() stürzt die App ab.
    return [{ key: "_all", label: null, items: filteredFirmen }];
  })();

  const groupedPersons: Group<FlatContact>[] = (() => {
    if (groupBy === "none") return [{ key: "_all", label: null, items: filteredPersons }];
    if (groupBy === "alpha") {
      const g: Record<string, FlatContact[]> = {};
      filteredPersons.forEach(c => { const k = c.name[0]?.toUpperCase() || "#"; (g[k] = g[k] || []).push(c); });
      return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([k, items]) => ({ key: k, label: k, items }));
    }
    if (groupBy === "firma") {
      const g: Record<string, FlatContact[]> = {};
      filteredPersons.forEach(c => { (g[c._firmaName] = g[c._firmaName] || []).push(c); });
      return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([k, items]) => ({ key: k, label: k, items }));
    }
    // Fallback: siehe groupedFirmen — verhindert undefined bei kurzzeitig
    // inkonsistentem groupBy/ansicht-State.
    return [{ key: "_all", label: null, items: filteredPersons }];
  })();

  const firmenGroupOpts  = [{ id: "alpha", label: "Alphabetisch" }, { id: "type", label: "Nach Kategorie" }, { id: "none", label: "Keine" }];
  const personGroupOpts  = [{ id: "alpha", label: "Alphabetisch" }, { id: "firma", label: "Nach Firma" }, { id: "none", label: "Keine" }];
  const activeGroupOpts  = showPersonsView ? personGroupOpts : firmenGroupOpts;
  const hasFilter        = search || ansicht !== "firmen";

  // ── Firma CRUD ─────────────────────────────────────────────────────────────
  const openNewFirm = (preset: Partial<Person> = {}) => {
    setFirmForm({ ...emptyFirm, ...preset, _hauptName: "", _hauptPosition: "", _hauptPhone: "", _hauptEmail: "" });
    setFirmModal({ isNew: true });
  };
  const openEditFirm = (id: string) => {
    const p = persons.find(x => x.id === id);
    if (!p) return;
    setFirmForm({ ...emptyFirm, ...p, _tags: (p.tags || []).join(", ") });
    setFirmModal({ id });
  };
  const saveFirm = () => {
    if (!firmForm.name?.trim()) return;
    const { _hauptName, _hauptPosition, _hauptPhone, _hauptEmail, _tags, ...rest } = firmForm;
    const tags = (_tags || "").split(",").map(t => t.trim()).filter(Boolean);
    const firmData = { ...rest, tags: tags.length ? tags : undefined };
    if (firmModal?.id) {
      update("persons", persons.map(p => p.id === firmModal.id ? { ...p, ...firmData } : p));
    } else {
      const hauptkontakt = _hauptName?.trim()
        ? [{ id: generateId(), name: _hauptName.trim(), position: _hauptPosition || "", phone: _hauptPhone || "", email: _hauptEmail || "" }]
        : [];
      update("persons", [...persons, { ...firmData, contacts: [...hauptkontakt, ...(firmData.contacts || [])], id: generateId() } as Person]);
    }
    setFirmModal(null);
  };
  // Löschen sofort, mit «Rückgängig» (undo.ts); Referenzen in Projekten und Rechnungen bleiben erhalten.
  // Wird der Kontakt noch verwendet, vorher nachfragen: Rechnungen/Offerten verlören sonst Name und Adresse.
  const { askConfirm, ConfirmModalEl } = useConfirm();
  const deleteFirm = async (id: string) => {
    const f = persons.find(p => p.id === id);
    const refs = personReferences(data, id);
    if (refs.length && !await askConfirm(<>«{f?.name}» wird noch verwendet: {refs.join(", ")}. Dort fehlen nach dem Löschen Name und Adresse (auch im PDF).</>, "Trotzdem löschen")) return;
    removeWithUndo(`Kontakt «${f?.name || ""}» gelöscht`, "persons", p => p.id === id);
    if (selectedId === id) setSelectedId(null);
  };
  const deleteContactFromFirm = (firmaId: string, personId: string) => {
    const c = persons.find(p => p.id === firmaId)?.contacts?.find(x => x.id === personId);
    changeWithUndo(`Ansprechpartner «${c?.name || ""}» entfernt`, prev => ({ ...prev, persons: (prev.persons || []).map(p => p.id === firmaId
      ? { ...p, contacts: (p.contacts || []).filter(x => x.id !== personId) } : p) }));
  };

  // ── Ansprechpartner CRUD ───────────────────────────────────────────────────
  const openNewPerson = (firmaId = "") => {
    setPersonForm({ firmaId, name: "", position: "", phone: "", email: "" });
    setPersonModal({ isNew: true });
  };
  const openEditPerson = (firmaId: string, personId: string) => {
    const firma = persons.find(p => p.id === firmaId);
    const person = (firma?.contacts || []).find(c => c.id === personId);
    if (!person) return;
    setPersonForm({ firmaId, name: person.name || "", position: person.position || "", phone: person.phone || "", email: person.email || "" });
    setPersonModal({ firmaId, personId });
  };
  const savePerson = () => {
    if (!personForm.name?.trim() || !personForm.firmaId) return;
    if (personModal?.personId) {
      update("persons", persons.map(p => p.id === personModal.firmaId
        ? { ...p, contacts: (p.contacts || []).map(c => c.id === personModal.personId ? { ...c, name: personForm.name as string, position: personForm.position, phone: personForm.phone, email: personForm.email } : c) } : p));
    } else {
      const newContact = { id: generateId(), name: personForm.name.trim(), position: personForm.position || "", phone: personForm.phone || "", email: personForm.email || "" };
      update("persons", persons.map(p => p.id === personForm.firmaId
        ? { ...p, contacts: [...(p.contacts || []), newContact] } : p));
    }
    setPersonModal(null);
  };


  // ── Detail view ────────────────────────────────────────────────────────────
  const selectedFirma = selectedId ? persons.find(p => p.id === selectedId) : null;
  if (selectedFirma) {
    return (
      <div>
        <FirmaDetail
          firma={selectedFirma}
          data={data}
          update={update}
          onBack={() => setSelectedId(null)}
          onEdit={() => openEditFirm(selectedFirma.id)}
          onAddPerson={() => openNewPerson(selectedFirma.id)}
          onEditPerson={openEditPerson}
          onDeletePerson={deleteContactFromFirm}
          onDeleteFirm={deleteFirm}
        />
        {ConfirmModalEl}
        {firmModal && renderFirmModal()}
        {personModal && renderPersonModal()}
      </div>
    );
  }

  // ── List view helpers ──────────────────────────────────────────────────────
  function renderFirmModal() {
    if (!firmModal) return null;
    return (
      <Modal drawer
        title={firmModal.id ? "Kontakt bearbeiten" : "Neuer Kontakt"}
        onClose={() => setFirmModal(null)}
        onSave={saveFirm}
      >
        <FormField label="Name *">
          <input autoFocus value={firmForm.name || ""} onChange={e => setFirmForm({ ...firmForm, name: e.target.value })}
            style={!firmForm.name?.trim() ? { borderColor: "var(--warning)" } : {}} />
        </FormField>
        <FormField label="Kategorie">
          <select value={firmForm.category || ""} onChange={e => setFirmForm({ ...firmForm, category: (e.target.value || undefined) as ContactCategory | undefined })}>
            <option value="">— keine —</option>
            {CONTACT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {isCloudBackend && <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}>Cloud-Modus: Herkunft, Empfehler und Tags (Akquise, Testbetrieb) werden noch nicht mit dem Server synchronisiert.</div>}
        </FormField>
        {(firmForm.category === "unternehmer" || firmForm.type) && (
          <FormField label="Fachrichtung / Branche">
            <select value={firmForm.type || ""} onChange={e => setFirmForm({ ...firmForm, type: e.target.value })}>
              <option value="">— auswählen —</option>
              {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
        )}
        <div className="form-row">
          <FormField label="Strasse"><input value={firmForm.street || ""} onChange={e => setFirmForm({ ...firmForm, street: e.target.value })} /></FormField>
          <FormField label="PLZ"><input value={firmForm.zip || ""} onChange={e => setFirmForm({ ...firmForm, zip: e.target.value })} style={{ maxWidth: 90 }} /></FormField>
          <FormField label="Ort"><input value={firmForm.city || ""} onChange={e => setFirmForm({ ...firmForm, city: e.target.value })} /></FormField>
        </div>
        <div className="form-row">
          <FormField label="E-Mail (Firma)"><input type="email" value={firmForm.email || ""} onChange={e => setFirmForm({ ...firmForm, email: e.target.value })} /></FormField>
          <FormField label="Telefon (Firma)"><input value={firmForm.phone || ""} onChange={e => setFirmForm({ ...firmForm, phone: e.target.value })} /></FormField>
          <FormField label="Website"><input value={firmForm.website || ""} onChange={e => setFirmForm({ ...firmForm, website: e.target.value })} /></FormField>
        </div>
        <div className="form-row">
          <FormField label="Herkunft">
            <select value={firmForm.source || ""} onChange={e => setFirmForm({ ...firmForm, source: e.target.value || undefined })}>
              <option value="">—</option>
              {(data.settings.leadSources || DEFAULT_LEAD_SOURCES).map(src => <option key={src} value={src}>{src}</option>)}
            </select>
          </FormField>
          <FormField label="Empfohlen von">
            <select value={firmForm.referredById || ""} onChange={e => setFirmForm({ ...firmForm, referredById: e.target.value || undefined })}>
              <option value="">—</option>
              {[...persons].filter(p => p.id !== firmModal?.id).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Tags (kommagetrennt)">
          <input value={firmForm._tags || ""} onChange={e => setFirmForm({ ...firmForm, _tags: e.target.value })} placeholder="z.B. Weihnachtskarte, Stammkunde" />
        </FormField>
        <FormField label="Notiz">
          <textarea value={firmForm.note || ""} onChange={e => setFirmForm({ ...firmForm, note: e.target.value })} rows={2} style={{ height: "auto" }} />
        </FormField>
        {!firmModal.id && (
          <>
            <SectionHead label="HAUPTKONTAKT (optional)" />
            <FormField label="Name">
              <input value={firmForm._hauptName || ""} onChange={e => setFirmForm({ ...firmForm, _hauptName: e.target.value })} placeholder="Vorname Nachname" />
            </FormField>
            <FormField label="Position / Funktion">
              <input value={firmForm._hauptPosition || ""} onChange={e => setFirmForm({ ...firmForm, _hauptPosition: e.target.value })} placeholder="z.B. Projektleiter" />
            </FormField>
            <div className="form-row">
              <FormField label="Telefon">
                <input value={firmForm._hauptPhone || ""} onChange={e => setFirmForm({ ...firmForm, _hauptPhone: e.target.value })} />
              </FormField>
              <FormField label="E-Mail">
                <input type="email" value={firmForm._hauptEmail || ""} onChange={e => setFirmForm({ ...firmForm, _hauptEmail: e.target.value })} />
              </FormField>
            </div>
          </>
        )}
        {firmModal.id && (() => {
          const contacts = firmForm.contacts || [];
          return (
            <>
              <SectionHead label="ANSPRECHPARTNER" />
              {contacts.length === 0 && <div style={{ fontSize: 12, color: "var(--text5)", marginBottom: 8 }}>Noch keine Ansprechpartner.</div>}
              {contacts.map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border2)" }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: 13 }}>{c.name}</span>
                    {c.position && <span style={{ fontSize: 12, color: "var(--text4)", marginLeft: 8 }}>{c.position}</span>}
                    {c.email && <span style={{ fontSize: 11, color: "var(--text5)", marginLeft: 8 }}>{c.email}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => { setFirmModal(null); openEditPerson(firmModal.id as string, c.id); }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                    <button type="button" className="btn-icon danger" title="Entfernen" aria-label="Entfernen"
                      onClick={() => setFirmForm(f => ({ ...f, contacts: (f.contacts || []).filter(x => x.id !== c.id) }))}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 10 }}
                onClick={() => { setFirmModal(null); openNewPerson(firmModal.id); }}>+ Person hinzufügen</button>
            </>
          );
        })()}
      </Modal>
    );
  }

  function renderPersonModal() {
    if (!personModal) return null;
    return (
      <Modal drawer title={personModal.personId ? "Person bearbeiten" : "Neue Person"} onClose={() => setPersonModal(null)} onSave={savePerson}>
        <FormField label="Firma *">
          <select value={personForm.firmaId || ""} onChange={e => setPersonForm({ ...personForm, firmaId: e.target.value })}
            style={!personForm.firmaId ? { borderColor: "var(--warning)" } : {}} disabled={!!personModal.personId}>
            <option value="">— Firma auswählen —</option>
            {[...persons].sort((a, b) => a.name.localeCompare(b.name, "de")).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
        <FormField label="Name *">
          <input autoFocus value={personForm.name || ""} onChange={e => setPersonForm({ ...personForm, name: e.target.value })}
            placeholder="Vorname Nachname" style={!personForm.name?.trim() ? { borderColor: "var(--warning)" } : {}} />
        </FormField>
        <FormField label="Position / Funktion">
          <input value={personForm.position || ""} onChange={e => setPersonForm({ ...personForm, position: e.target.value })} placeholder="z.B. Bauleiter" />
        </FormField>
        <div className="form-row">
          <FormField label="Telefon"><input value={personForm.phone || ""} onChange={e => setPersonForm({ ...personForm, phone: e.target.value })} /></FormField>
          <FormField label="E-Mail"><input type="email" value={personForm.email || ""} onChange={e => setPersonForm({ ...personForm, email: e.target.value })} /></FormField>
        </div>
      </Modal>
    );
  }

  // ── List render ────────────────────────────────────────────────────────────
  return (
    <div>
      {ConfirmModalEl}
      <Header title="Kontakte" action={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => openNewPerson()} disabled={persons.length === 0} title={persons.length === 0 ? "Zuerst einen Kontakt anlegen" : ""}>+ Ansprechpartner</button>
          <button className="btn btn-primary" onClick={() => openNewFirm()}>+ Neuer Kontakt</button>
        </div>
      } />

      <div className="filter-bar">
        <input className="pill" placeholder="Suche (Kontakt, Ansprechpartner, E-Mail…)" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select className="pill" value={ansicht} onChange={e => { setAnsicht(e.target.value); setGroupBy("alpha"); }}>
          <option value="firmen">Alle Kontakte</option>
          {CONTACT_CATEGORIES.map(c => <option key={c.id} value={`cat:${c.id}`}>{c.label}</option>)}
          <option value="personen">Ansprechpartner (Einzelpersonen)</option>
        </select>
        {hasFilter && <button className="btn btn-ghost" onClick={() => { setSearch(""); setAnsicht("firmen"); setGroupBy("alpha"); }} style={{ fontSize: 12 }}>Zurücksetzen</button>}
      </div>

      <TableToolbar detached
        summary={showPersonsView
          ? <><b className="num">{filteredPersons.length}</b> {filteredPersons.length === 1 ? "Person" : "Personen"}</>
          : <><b className="num">{filteredFirmen.length}</b> {filteredFirmen.length === 1 ? "Kontakt" : "Kontakte"} · {allPersonsFlat.length} Ansprechpartner</>}
        groups={activeGroupOpts} value={groupBy} onChange={setGroupBy} />

      {/* Einzelpersonen-Ansicht */}
      {showPersonsView ? (
        filteredPersons.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text4)" }}>
            {allPersonsFlat.length === 0 ? "Noch keine Ansprechpartner erfasst." : "Keine Treffer"}
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table style={{ width: "100%" }}>
              <thead><tr>
                <th>Name</th>
                <th className="hide-narrow" style={{ width: 160 }}>Position</th>
                <th style={{ width: 200 }}>Firma</th>
                <th>E-Mail</th>
                <th className="hide-narrow" style={{ width: 140 }}>Telefon</th>
                <th style={{ width: 52 }}></th>
              </tr></thead>
              <tbody>
                {groupedPersons.map(group => (
                  <React.Fragment key={group.key}>
                    {group.label && <tr><td colSpan={6} className="group-row">{group.label}<span className="group-sum">{group.items.length}</span></td></tr>}
                    {group.items.map(c => (
                      <tr key={`${c._firmaId}-${c.id}`} className="row-link" onClick={() => setSelectedId(c._firmaId)}>
                        <td><strong>{c.name}</strong></td>
                        <td className="hide-narrow" style={{ fontSize: 12.5, color: "var(--text3)" }}>{c.position || <span style={{ color: "var(--text5)" }}>—</span>}</td>
                        <td style={{ fontSize: 12.5, color: "var(--text2)" }}>
                          {c._firmaName}
                          {c._firmaType && <span style={{ fontSize: 11, color: "var(--text5)", marginLeft: 6 }}>{c._firmaType}</span>}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--text3)" }}>{c.email || <span style={{ color: "var(--text5)" }}>—</span>}</td>
                        <td className="hide-narrow" style={{ fontSize: 12.5, color: "var(--text3)" }}>{c.phone || <span style={{ color: "var(--text5)" }}>—</span>}</td>
                        <td className="row-actions" onClick={e => e.stopPropagation()}>
                          <RowMenu items={[
                            { label: "Bearbeiten", icon: "edit", onClick: () => openEditPerson(c._firmaId, c.id) },
                            { label: "Firma öffnen", icon: "open_in_new", onClick: () => setSelectedId(c._firmaId) },
                            { label: "Entfernen", icon: "delete", danger: true, onClick: () => deleteContactFromFirm(c._firmaId, c.id) },
                          ]} />
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* Firmen-Ansicht */
        filteredFirmen.length === 0 ? (
          <div className="card">
            {persons.length === 0
              ? <EmptyState icon="group" title="Noch keine Kontakte" text="Bauherrschaften, Fachplaner, Unternehmer und Behörden — mit Ansprechpartnern, Projekten und Rechnungen an einem Ort."
                  action={<button className="btn btn-primary" onClick={() => openNewFirm()}>+ Neuer Kontakt</button>} />
              : <div className="empty-state">Keine Treffer</div>}
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table style={{ width: "100%" }}>
              <thead><tr>
                <th>Kontakt</th>
                <th style={{ width: 150 }}>Kategorie</th>
                <th className="hide-narrow" style={{ width: 140 }}>Branche / Typ</th>
                <th className="hide-narrow">Adresse</th>
                <th>Hauptkontakt</th>
                <th style={{ textAlign: "right", width: 80 }}>Projekte</th>
                <th style={{ width: 52 }}></th>
              </tr></thead>
              <tbody>
                {groupedFirmen.map(group => (
                  <React.Fragment key={group.key}>
                    {group.label && <tr><td colSpan={7} className="group-row">{group.label}<span className="group-sum">{group.items.length}</span></td></tr>}
                    {group.items.map(p => {
                      const addr = [p.street, [p.zip, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
                      const projCount = projects.filter(pr => pr.clientId === p.id || (pr.projectContacts || []).some(pc => pc.contactId === p.id)).length;
                      const contacts = p.contacts || [];
                      const hauptkontakt = contacts[0] || null;
                      return (
                        <tr key={p.id} className="row-link" onClick={() => setSelectedId(p.id)}>
                          <td>
                            <strong>{p.name}</strong>
                            {p.email && <div style={{ fontSize: 12, color: "var(--text4)" }}>{p.email}</div>}
                          </td>
                          <td><CategoryBadge person={p} /></td>
                          <td className="hide-narrow" style={{ fontSize: 12.5, color: "var(--text4)" }}>{p.type || <span style={{ color: "var(--text5)" }}>—</span>}</td>
                          <td className="hide-narrow" style={{ fontSize: 12.5, color: "var(--text3)" }}>{addr || <span style={{ color: "var(--text5)" }}>—</span>}</td>
                          <td style={{ fontSize: 12.5 }}>
                            {hauptkontakt ? (
                              <div>
                                <span style={{ fontWeight: 500 }}>{hauptkontakt.name}</span>
                                {hauptkontakt.position && <span style={{ color: "var(--text4)" }}>, {hauptkontakt.position}</span>}
                                {contacts.length > 1 && <span style={{ fontSize: 11, color: "var(--text4)", marginLeft: 6 }}>+{contacts.length - 1}</span>}
                              </div>
                            ) : <span style={{ color: "var(--text5)" }}>—</span>}
                          </td>
                          <td style={{ textAlign: "right", fontSize: 12.5, color: projCount ? "var(--text)" : "var(--text5)", fontWeight: projCount ? 600 : 400 }}>{projCount || "—"}</td>
                          <td className="row-actions" onClick={e => e.stopPropagation()}>
                            <RowMenu items={[
                              { label: "Bearbeiten", icon: "edit", onClick: () => openEditFirm(p.id) },
                              { label: "Ansprechpartner hinzufügen", icon: "person_add", onClick: () => openNewPerson(p.id) },
                              { label: "Löschen", icon: "delete", danger: true, onClick: () => deleteFirm(p.id) },
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {firmModal && renderFirmModal()}
      {personModal && renderPersonModal()}
    </div>
  );
}
