// State-Migrations für geladene `data`-Objekte.
//
// Extrahiert aus App.jsx, damit der Initial-Load über den (async) Adapter
// laufen kann und die Migrations sowohl auf Local- als auch Cloud-Daten
// dieselbe Form anwenden.
//
// Reine Funktion: nimmt geparste Rohdaten + defaultData entgegen, gibt das
// migrierte `data`-Objekt zurück. Keine Side-Effects, kein Storage-Zugriff.
//
// Wichtig: Migrationen müssen idempotent sein — `applyMigrations` läuft bei
// JEDEM Laden, nicht nur einmal. Jede Migration prüft deshalb selbst, ob
// sie noch etwas zu tun hat. Es gibt keine Versionsnummer im Datenbestand.
// Neue Felder, die nur einen Default brauchen, gehören in `defaultData`
// (werden unten per Spread ergänzt), nicht hierher.

import { migrateDashboardLayout } from "../utils";
import { validateRawData } from "./validate";
import type { AppData, AppRole, Id, Person, Project, Protocol, User } from "../types";

// Alte Datenformen, die es nur noch in bestehenden Beständen gibt.
type LegacyContact = Partial<Person> & { id: Id; linkedClientId?: Id };
type LegacyClient = Partial<Person> & { id: Id; linkedContactId?: Id; linkedClientId?: Id };
/** `type` ist der alte Name von `billingType`. */
type LegacyProject = Project & { type?: string };
/** `entries` war die flache Eintragsliste vor den Traktanden. */
type LegacyProtocol = Protocol & { entries?: { assignee?: Id; [key: string]: unknown }[] };

/** Rohdaten, wie sie aus dem Speicher kommen: alles optional, ggf. alte Felder. */
export type RawData = Partial<Omit<AppData, "projects" | "protocols">> & {
  projects?: LegacyProject[];
  protocols?: LegacyProtocol[];
  /** Vor der Zusammenführung zu `persons`: Auftraggeber. */
  clients?: LegacyClient[];
  /** Vor der Zusammenführung zu `persons`: Fachplaner/Partner. */
  contacts?: LegacyContact[];
};

/** Zwischenstand während der Migration: aktuelle Felder plus ggf. noch alte Formen. */
type Merged = Omit<AppData, "projects" | "protocols"> & Pick<RawData, "projects" | "protocols" | "clients" | "contacts"> & {
  projects: LegacyProject[];
  protocols: LegacyProtocol[];
};

/**
 * Bringt geladene Daten auf den aktuellen Stand des Datenmodells.
 *
 * @param raw Rohdaten aus localStorage, Datenordner bzw. Cloud (beliebig alt, evtl. beschädigt).
 * @param defaultData Startzustand aus constants.ts; liefert fehlende Felder und Vorlagen.
 * @param onProblems wird aufgerufen, wenn die Formprüfung (validate.ts) etwas reparieren musste — für den Hinweis in der App.
 * @returns vollständiges `AppData`-Objekt. Die Eingabe wird nicht verändert.
 */
export function applyMigrations(raw: RawData, defaultData: AppData, onProblems?: (problems: string[]) => void): AppData {
  // Zuerst die grobe Form prüfen (kaputte Daten sollen nicht beim Rendern abstürzen, siehe validate.ts)
  const { data: parsed, problems } = validateRawData(raw, defaultData);
  if (problems.length) {
    console.warn("Geladene Daten repariert:", problems);
    onProblems?.(problems);
  }
  let merged = {
    ...defaultData,
    ...parsed,
    settings: { ...defaultData.settings, ...parsed.settings },
  } as Merged;

  // Migrate: clients[] + contacts[] → persons[]
  // Früher getrennte Listen für Auftraggeber und Partner; heute eine Liste mit
  // den Flags isAuftraggeber/isPartner. Ein Kontakt, der auf einen Client
  // verlinkt war (linkedContactId), wird mit diesem zusammengeführt; die
  // alten Kontakt-IDs werden in Projekten und Protokollen auf die neue ID umgebogen.
  if (!merged.persons && (merged.clients?.length || merged.contacts?.length)) {
    const idMap: Record<Id, Id> = {};
    const persons: Person[] = [];
    const usedContactIds = new Set<Id>();
    for (const c of merged.clients || []) {
      const linked = (merged.contacts || []).find(ct => ct.id === c.linkedContactId);
      persons.push({
        ...c,
        isAuftraggeber: true,
        isPartner: !!linked,
        type: c.type || linked?.type || "",
        note: c.note || linked?.note || "",
        honorarOffers: c.honorarOffers || linked?.honorarOffers || [],
        contacts: c.contacts?.length ? c.contacts : (linked?.contacts || []),
        linkedContactId: undefined,
        linkedClientId: undefined,
      } as Person);
      if (linked) { usedContactIds.add(linked.id); idMap[linked.id] = c.id; }
    }
    for (const ct of merged.contacts || []) {
      if (usedContactIds.has(ct.id)) continue;
      persons.push({ ...ct, isAuftraggeber: false, isPartner: true, linkedClientId: undefined } as Person);
    }
    const remapProjects = (merged.projects || []).map(p => ({
      ...p,
      projectContacts: (p.projectContacts || []).map(pc => ({
        ...pc,
        contactId: pc.contactId ? (idMap[pc.contactId] || pc.contactId) : pc.contactId,
      })),
    }));
    const remapProtocols = (merged.protocols || []).map(p => ({
      ...p,
      entries: (p.entries || []).map(e => ({ ...e, assignee: e.assignee ? (idMap[e.assignee] || e.assignee) : e.assignee })),
    }));
    merged = { ...merged, persons, projects: remapProjects, protocols: remapProtocols, clients: undefined, contacts: undefined };
  }

  // Migrate: projects linked to SIA/manual quotes should be pauschal (not stundensatz)
  // Früher waren solche Projekte oft fälschlich auf Stundensatz; `p.type` ist
  // der alte Name von `billingType`.
  const allQuotes = merged.quotes || [];
  const projects = (merged.projects || []).map(p => {
    if ((p.billingType || p.type || "stundensatz") === "stundensatz" && (p.linkedQuotes || []).length > 0) {
      const linkedQs = (p.linkedQuotes || []).map(lq => allQuotes.find(q => q.id === lq.quoteId)).filter(Boolean);
      if (linkedQs.some(q => q!.mode === "sia" || q!.mode === "manual")) {
        return { ...p, billingType: "pauschal", budget: p.budget || p.budgetAmount || 0 };
      }
    }
    return p;
  });

  // Migrate: add r-projektleiter if missing, seed dashboardTemplateId from defaultData
  const roleDefMap = (defaultData.appRoles || []).reduce<Record<Id, AppRole>>((acc, r) => { acc[r.id] = r; return acc; }, {});
  const roles: AppRole[] = (merged.appRoles || defaultData.appRoles).map(r => ({
    ...r,
    dashboardTemplateId: r.dashboardTemplateId || roleDefMap[r.id]?.dashboardTemplateId || null,
  }));
  if (!roles.find(r => r.id === "r-projektleiter") && roleDefMap["r-projektleiter"]) {
    const adminIdx = roles.findIndex(r => r.id === "r-admin");
    roles.splice(adminIdx + 1, 0, roleDefMap["r-projektleiter"]);
  }

  // Migrate user-level dashboardWidgets to Row[] format
  // (altes Format: flache Liste von Widget-Ids; neu: Zeilen mit Spalten).
  const users: User[] = (merged.users || []).map(u => ({
    ...u,
    dashboardWidgets: u.dashboardWidgets ? migrateDashboardLayout(u.dashboardWidgets) : undefined,
  }));

  // Ensure dashboardTemplates exist (old data won't have them)
  const dashboardTemplates = merged.dashboardTemplates?.length ? merged.dashboardTemplates : defaultData.dashboardTemplates;

  return { ...merged, projects, appRoles: roles, users, dashboardTemplates };
}
