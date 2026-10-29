// PocketBaseAdapter — Feld-Mapper.
//
// Übersetzt zwischen PocketBase-Records (`fromDB`: DB → App, `toDB`: App → DB)
// und den Entitäten aus types.ts. Genutzt nur von pocketbase-adapter.ts.
//
// Anders als bei Supabase (snake_case-Spalten, siehe supabase-mappers.js) heissen die
// PocketBase-Collection-Felder direkt camelCase wie im Frontend — das erspart den
// grössten Teil des Mappings. Was hier bleibt: JSON-Felder mit sinnvollem Default
// entpacken, PocketBase-Relation-IDs auf die Frontend-Feldnamen ziehen, und
// studioRoles (eigene Collection) in settings.roles zusammenführen.
//
// Abweichende Feldnamen (App ↔ PocketBase) — hier nachschlagen, bevor man sich
// über «fehlende» Felder wundert:
//   clientId / projectId / quoteId …   ↔  client / project / quote   (Relationen)
//   employeeId (meist)                 ↔  employee
//   person.type                        ↔  personType
//   settings.mwst                      ↔  mwstNr
//   settings.protokollTypeAbbreviations ↔ protokollTypeAbbr
//   quote.sia                          ↔  siaConfig
//   employee.pkAGSatz                  ↔  pkAgSatz
//   protocol.nummer                    ↔  number
//   absence.type                       ↔  typeId
//   blogPost.type                      ↔  category
//   overtimeClosing.empId              ↔  employee
//   expense.lohnEntryId                ↔  lohnEntry
//   *.createdAt                        ↔  created (von PocketBase gesetzt)
//
// Regeln für alle Mapper:
//   - fromDB macht fehlende Werte zu sicheren Defaults ("" / [] / null), weil
//     PocketBase leere Felder als "" liefert, die App aber null/undefined schreibt.
//   - Datumsfelder werden auf `YYYY-MM-DD` gekürzt (PocketBase liefert Zeitstempel).
//   - toDB setzt `studio` (Mandant) auf jeder Zeile; Ausnahme: `person`, siehe dort.
//   - Neue Felder müssen in fromDB UND toDB (und im PocketBase-Schema) ergänzt
//     werden, sonst gehen sie beim Cloud-Sync verloren.
//
// Der Typ `RecordModel` von PocketBase ist absichtlich locker (beliebige Felder):
// die Datenbank-Seite ist untypisiert, die App-Seite (Rückgabe von fromDB,
// Parameter von toDB) ist über types.ts typisiert.

import type { RecordModel } from "pocketbase";
import { EXPENSE_CATEGORIES, INTERNAL_EXPENSE_CATEGORIES } from "../constants";
import type {
  AbsenzType, Absence, AppRole, BlogPost, ContactCategory, DashboardTemplate, ProtocolApproval, DeliveryNote, DocAsset, Employee,
  Expense, Feiertag, FerienEntry, Id, InternalExpense, Invoice, LetterTemplate, LohnEntry,
  OvertimeClosing, Person, Project, Protocol, Quote, Contract, Role, Settings, TimeEntry,
} from "../types";

type Row = RecordModel;

/** PocketBase-Record → App-Entität. */
export const fromDB = {
  /** Setzt `settings` aus der Settings-Zeile und den Rollen-Zeilen (eigene Collection `studioRoles`) zusammen. */
  studioSettings(row: Row | undefined, roles: Row[] = []) {
    if (!row) return undefined;
    return {
      name: row.name || "Mein Studio",
      address: row.address || "",
      street: row.street || "", zip: row.zip || "", city: row.city || "", country: row.country || "CH",
      email: row.email || "", phone: row.phone || "",
      iban: row.iban || "", ibanType: row.ibanType || "qr",
      // JS-Property heisst "mwst" (nicht "mwstNr") — Settings.jsx liest/schreibt
      // ausschliesslich "s.mwst". "mwstNr" bleibt der PocketBase-Feldname.
      mwst: row.mwstNr || "", mwstRate: row.mwstRate ?? 8.1,
      defaultHourlyRate: row.defaultHourlyRate ?? 120,
      defaultWochenstunden: row.defaultWochenstunden ?? 35,
      defaultFerienWochen: row.defaultFerienWochen ?? 5,
      defaultPkAGSatz: row.defaultPkAGSatz ?? 8.0,
      vertragNumberFormat: row.vertragNumberFormat || "V-YYYY-NNN",
      // Projektnummern-Zähler (Projects.jsx/Quotes.jsx) — ohne diese beiden
      // startet die Sequenz nach jedem Cloud-Reload bei 0 (doppelte Nummern).
      lastProjectSeq: row.lastProjectSeq ?? 0,
      lastProjectYear: row.lastProjectYear ?? null,
      // StudioBudget.jsx: aktueller Stand + archivierte Versionen, beide
      // von Natur aus frei wachsende Strukturen (siehe payrollEntry.data).
      studioBudget: row.studioBudget || {},
      studioBudgetVersions: row.studioBudgetVersions || [],
      // formats-Blob nennt das Feld "protocolNumberFormat" (Schema-intern) —
      // Settings.jsx liest ausschliesslich "protokollNumberFormat" (Deutsch).
      ...(row.formats || {}), protokollNumberFormat: row.formats?.protocolNumberFormat || "",
      ...(row.pageMargins || {}),
      // expenseCategories/internalExpenseCategories/closedMonths/blockMaiTag
      // haben keine eigene PB-Spalte — leben im ui-JSON-Blob (keine eigene
      // Migration nötig, ui ist schon ein freies JSON-Feld).
      ...(row.ui || {}),
      expenseCategories: row.ui?.expenseCategories || [...EXPENSE_CATEGORIES],
      internalExpenseCategories: row.ui?.internalExpenseCategories || [...INTERNAL_EXPENSE_CATEGORIES],
      closedMonths: row.ui?.closedMonths || [],
      blockMaiTag: row.ui?.blockMaiTag !== false,
      // JS-Property heisst "protokollTypeAbbreviations" — Settings.jsx liest/
      // schreibt ausschliesslich diesen Namen. "protokollTypeAbbr" bleibt der
      // PocketBase-Feldname.
      protokollTypeAbbreviations: row.protokollTypeAbbr || {},
      // JS-Property heisst "logo" (nicht "logoUrl") — UI.jsx/Settings.jsx
      // lesen/schreiben ausschliesslich settings.logo (Base64-Data-URL,
      // kein echter Upload — gleiches Muster wie expense.receiptData).
      logo: row.logo || "",
      roles: (roles || []).map(r => ({ id: r.roleId, label: r.label, rate: r.rate, sort: r.sort })),
    };
  },

  person(row: Row) {
    return {
      id: row.id,
      // Geteilte Person (über mehrere Studios sichtbar) hat studio == "" und
      // lebt stattdessen über personStudioLinks — siehe pb/-Migration
      // "person_sharing". isShared steuert in toDB.person, ob beim Zurückschreiben
      // das studio-Feld angefasst wird.
      isShared: !row.studio,
      name: row.name,
      // JS-Property heisst "type" (nicht "personType") — Persons.jsx liest/
      // schreibt ausschliesslich "p.type". "personType" bleibt der PocketBase-
      // Feldname.
      type: row.personType || "",
      isAuftraggeber: !!row.isAuftraggeber,
      isPartner: !!row.isPartner,
      // Kontakt-Kategorie (PB-Migration person_category); leer bei Altdaten.
      category: (row.category || undefined) as ContactCategory | undefined,
      street: row.street || "", zip: row.zip || "", city: row.city || "", country: row.country || "CH",
      email: row.email || "", phone: row.phone || "", website: row.website || "",
      note: row.note || "",
      contacts: row.contacts || [],
      honorarOffers: row.honorarOffers || [],
    };
  },

  project(row: Row) {
    return {
      id: row.id,
      number: row.number || "",
      name: row.name,
      clientId: row.client || null,
      category: row.category || "",
      billingType: row.billingType || "",
      hourlyRate: row.hourlyRate ?? null,
      budget: row.budget ?? null,
      budgetHours: row.budgetHours ?? null,
      status: row.status || "aktiv",
      description: row.description || "",
      startDate: row.startDate ? row.startDate.slice(0, 10) : "",
      enabledPhases: row.enabledPhases || [],
      positions: row.positions || [],
      customPhases: row.customPhases || [],
      projectContacts: row.projectContacts || [],
      internalMembers: row.internalMembers || [],
      linkedQuotes: row.linkedQuotes || [],
      // Von deriveQuoteBudget() einmal berechnet & aufs Projekt geschrieben,
      // wenn eine Offerte verknüpft wird — Invoices.jsx braucht sie direkt
      // für Akonto-/Teilrechnungen (Restbudget), nicht neu berechnet.
      budgetAmount: row.budgetAmount ?? null,
      phasesBudget: row.phasesBudget || [],
      // PocketBase setzt "created" automatisch beim Insert — Projects.jsx
      // nutzt es als Fallback für die Jahres-Gruppierung, wenn startDate fehlt.
      createdAt: row.created || "",
    };
  },

  employee(row: Row) {
    return {
      id: row.id,
      name: row.name,
      role: row.role || "",
      personalNr: row.personalNr || "",
      adresse: row.adresse || "",
      ort: row.ort || "",
      ahvNr: row.ahvNr || "",
      geburtsdatum: row.geburtsdatum ? row.geburtsdatum.slice(0, 10) : "",
      email: row.email || "",
      eintrittsdatum: row.eintrittsdatum ? row.eintrittsdatum.slice(0, 10) : "",
      pensum: row.pensum ?? null,
      wochenstunden: row.wochenstunden ?? null,
      ferienWochen: row.ferienWochen ?? null,
      monatslohn: row.monatslohn ?? null,
      lohnIban: row.lohnIban || "",
      dreizehnterLohn: !!row.dreizehnterLohn,
      ahvSatz: row.ahvSatz ?? null,
      alvSatz: row.alvSatz ?? null,
      bvgSatz: row.bvgSatz ?? null,
      nbuSatz: row.nbuSatz ?? null,
      ktgSatz: row.ktgSatz ?? null,
      quellensteuerPflichtig: !!row.quellensteuerPflichtig,
      quellensteuerSatz: row.quellensteuerSatz ?? null,
      // JS-Property heisst "pkAGSatz" (nicht "pkAgSatz") — Employees.jsx/
      // utils.js lesen/schreiben ausschliesslich "emp.pkAGSatz". "pkAgSatz"
      // bleibt der PocketBase-Feldname.
      pkAGSatz: row.pkAgSatz ?? null,
      ferienUebertragVorjahr: row.ferienUebertragVorjahr || {},
      appUserId: row.appUser || null,
      active: row.active !== false,
    };
  },

  quote(row: Row) {
    return {
      id: row.id,
      number: row.number || "",
      clientId: row.client || null,
      projectId: row.project || null,
      projectName: row.projectName || "",
      date: row.date ? row.date.slice(0, 10) : "",
      validUntil: row.validUntil ? row.validUntil.slice(0, 10) : "",
      mode: row.mode || "",
      mwst: row.mwst !== false,
      notes: row.notes || "",
      status: row.status || "entwurf",
      // JS-Property heisst "sia" (nicht "siaConfig") — Quotes.jsx liest/schreibt
      // ausschliesslich "q.sia". "siaConfig" bleibt der PocketBase-Feldname.
      sia: row.siaConfig || null,
      manualPhases: row.manualPhases || [],
      freeItems: row.freeItems || [],
      quoteRoles: row.quoteRoles || [],
      // Summen werden von Quotes.jsx EINMAL beim Speichern berechnet (calcSIAHours/
      // calcManualHours) und dann direkt angezeigt, nicht bei jedem Render neu
      // berechnet — müssen deshalb mit persistiert werden.
      sub: row.sub ?? 0, totalHours: row.totalHours ?? 0, tax: row.tax ?? 0, total: row.total ?? 0,
      mwstRate: row.mwstRate ?? null,
    };
  },

  contract(row: Row) {
    return {
      id: row.id,
      number: row.number || "",
      clientId: row.client || null,
      projectId: row.project || null,
      quoteId: row.quote || null,
      contractType: row.contractType || "haupt",
      legalBasis: row.legalBasis || "",
      billingType: row.billingType || "pauschal",
      amount: row.amount ?? 0,
      hourlyRate: row.hourlyRate ?? 0,
      paymentTerms: row.paymentTerms || "",
      date: row.date ? row.date.slice(0, 10) : "",
      signedDate: row.signedDate ? row.signedDate.slice(0, 10) : "",
      status: row.status || "entwurf",
      notes: row.notes || "",
    };
  },

  invoice(row: Row) {
    return {
      id: row.id,
      number: row.number || "",
      clientId: row.client || null,
      contactId: row.contactId || null,
      projectId: row.project || null,
      quoteId: row.quote || null,
      date: row.date ? row.date.slice(0, 10) : "",
      dueDate: row.dueDate ? row.dueDate.slice(0, 10) : "",
      sentDate: row.sentDate ? row.sentDate.slice(0, 10) : "",
      paidDate: row.paidDate ? row.paidDate.slice(0, 10) : "",
      items: row.items || [],
      mwst: row.mwst !== false,
      mwstRate: row.mwstRate ?? null,
      notes: row.notes || "",
      status: row.status || "entwurf",
      invoiceKind: row.invoiceKind || "",
      discountType: row.discountType || "none",
      discountValue: row.discountValue || 0,
      discountLabel: row.discountLabel || "",
      entrySelections: row.entrySelections || {},
      qrReference: row.qrReference || "",
      reminders: row.reminders || [],
      // Wie bei quote: einmal berechnet (calcTotal in Invoices.jsx), dann nur
      // noch angezeigt — muss mit persistiert werden, sonst CHF 0.00 nach Reload.
      sub: row.sub ?? 0, tax: row.tax ?? 0, total: row.total ?? 0,
      subAfterDisc: row.subAfterDisc ?? 0, globalDisc: row.globalDisc ?? 0,
    };
  },

  timeEntry(row: Row) {
    return {
      id: row.id,
      employeeId: row.employee || null,
      projectId: row.project || null,
      phaseId: row.phaseId || "",
      positionId: row.positionId || "",
      date: row.date ? row.date.slice(0, 10) : "",
      minutes: row.minutes,
      startTime: row.startTime || "",
      endTime: row.endTime || "",
      description: row.description || "",
      // Markiert, ob dieser Eintrag schon auf einer Rechnung ist (Invoices.jsx
      // Bearbeitungs-/Löschsperre + Ausschluss aus "unverrechneten Stunden").
      invoiceId: row.invoice || null,
      // PocketBase setzt "created" automatisch — Time.jsx sortiert die
      // Tagesansicht danach (Erfassungsreihenfolge statt PB-Rückgabereihenfolge).
      createdAt: row.created || "",
    };
  },

  expense(row: Row) {
    return {
      id: row.id,
      employeeId: row.employee || null,
      projectId: row.project || null,
      date: row.date ? row.date.slice(0, 10) : "",
      category: row.category || "",
      description: row.description || "",
      amount: row.amount,
      mwstRate: row.mwstRate ?? null,
      inclMwst: row.inclMwst !== false,
      status: row.status || "offen",
      // JS-Property heisst "receiptData" (Base64-Data-URL, kein echter
      // PocketBase-File-Upload) — Expenses.jsx/Time.jsx lesen/schreiben
      // ausschliesslich "e.receiptData".
      receiptData: row.receiptData || "",
      receiptName: row.receiptName || "",
      lohnEntryId: row.lohnEntry || null,
    };
  },

  internalExpense(row: Row) {
    return {
      id: row.id,
      date: row.date ? row.date.slice(0, 10) : "",
      category: row.category || "",
      description: row.description || "",
      amount: row.amount,
      mwstRate: row.mwstRate ?? null,
      inclMwst: row.inclMwst !== false,
      recurring: !!row.recurring,
      recurringInterval: row.recurringInterval || "",
      // Wie expense.receiptData: Base64-Data-URL, kein echter PocketBase-File-
      // Upload — InternalExpenses.jsx liest/schreibt ausschliesslich diese Namen.
      receiptData: row.receiptData || "",
      receiptName: row.receiptName || "",
    };
  },

  absence(row: Row) {
    return {
      id: row.id,
      employeeId: row.employee,
      // JS-Property heisst "type" (nicht "typeId") — so liest/schreibt die
      // gesamte UI es (Time.jsx, Employees.jsx: a.type). "typeId" ist nur der
      // PocketBase-interne Feldname.
      type: row.typeId || "",
      date: row.date ? row.date.slice(0, 10) : "",
      dateFrom: row.dateFrom ? row.dateFrom.slice(0, 10) : "",
      dateTo: row.dateTo ? row.dateTo.slice(0, 10) : "",
      startTime: row.startTime || "",
      endTime: row.endTime || "",
      hours: row.hours ?? null,
      minutes: row.minutes ?? null,
      note: row.note || "",
      status: row.status || "pending",
    };
  },

  vacationEntry(row: Row) {
    return {
      id: row.id,
      employeeId: row.employee,
      dateFrom: row.dateFrom ? row.dateFrom.slice(0, 10) : "",
      dateTo: row.dateTo ? row.dateTo.slice(0, 10) : "",
      note: row.note || "",
      status: row.status || "pending",
      originalData: row.originalData || null,
    };
  },

  // Payroll.jsx behandelt einen Lohneintrag als grosses Objekt (empSnapshot,
  // saetzeSnapshot, bruttoWasOverridden, bonusBeschrieb, spesenIds + alle
  // calcLohn()-Ausgabefelder) — statt jedes Feld einzeln zu spiegeln, lebt
  // der Grossteil im freien "data"-JSON-Blob, employee/monat sind eigene
  // Spalten (für die findEntry()-Suche in Payroll.jsx).
  payrollEntry(row: Row) {
    return {
      id: row.id,
      employeeId: row.employee,
      monat: row.monat || "",
      ...(row.data || {}),
    };
  },

  // Employees.jsx legt hier Überstunden-AUSZAHLUNGEN ab (type:"payout" +
  // hoursSettled/zuschlagPercent/stundenlohn/auszahlungBetrag/year), nicht
  // einen Saldo-Snapshot. JS-Property "empId" (nicht "employeeId") — so
  // liest/schreibt Employees.jsx es durchgehend.
  overtimeClosing(row: Row) {
    return {
      id: row.id,
      empId: row.employee,
      year: row.year ?? null,
      date: row.date ? row.date.slice(0, 10) : "",
      type: row.type || "payout",
      hoursSettled: row.hoursSettled ?? 0,
      zuschlagPercent: row.zuschlagPercent ?? 0,
      stundenlohn: row.stundenlohn ?? 0,
      auszahlungBetrag: row.auszahlungBetrag ?? 0,
    };
  },

  protocol(row: Row) {
    return {
      id: row.id,
      // JS-Property heisst "nummer" (nicht "number") — Protocols.jsx liest/
      // schreibt ausschliesslich "p.nummer". "number" bleibt der PocketBase-
      // Feldname.
      nummer: row.number || "",
      title: row.title || "",
      date: row.date ? row.date.slice(0, 10) : "",
      time: row.time || "",
      endTime: row.endTime || "",
      type: row.type || "",
      location: row.location || "",
      projectId: row.project || null,
      projectManual: row.projectManual || "",
      participants: row.participants || [],
      traktanden: row.traktanden || [],
      nextDate: row.nextDate ? row.nextDate.slice(0, 10) : "",
      verteiler: row.verteiler || "",
      // Genehmigungsvermerk (PB-Migration protocol_approval); leer = Büro-Vorgabe
      approval: (row.approval || undefined) as ProtocolApproval | undefined,
      approvalHours: row.approvalHours || undefined,
    };
  },

  deliveryNote(row: Row) {
    return {
      id: row.id,
      number: row.number || "",
      date: row.date ? row.date.slice(0, 10) : "",
      clientId: row.client || null,
      clientManual: row.clientManual || "",
      projectId: row.project || null,
      projectManual: row.projectManual || "",
      deliveryAddress: row.deliveryAddress || "",
      notes: row.notes || "",
      items: row.items || [],
    };
  },

  blogPost(row: Row) {
    return {
      id: row.id,
      authorId: row.author || null,
      authorName: row.authorName || "",
      // JS-Property heisst "type" (nicht "category") — Pinboard.jsx/
      // Dashboard.jsx lesen/schreiben ausschliesslich "p.type" (beitrag/
      // ankuendigung/event). "category" bleibt der PocketBase-Feldname.
      type: row.category || "beitrag",
      title: row.title || "",
      body: row.body || "",
      pinned: !!row.pinned,
      status: row.status || "published",
      poll: row.poll || null,
      image: row.image || "",
      eventDate: row.eventDate ? row.eventDate.slice(0, 10) : "",
      createdAt: row.created,
    };
  },

  // Dokument-Design: Schrift oder Briefpapier als Data-URL (wie settings.logo, kein echter Upload).
  docAsset(row: Row) {
    return {
      id: row.id,
      kind: row.kind || "font",
      name: row.name || "",
      family: row.family || undefined,
      weight: row.weight || undefined,
      style: (row.style || undefined) as "normal" | "italic" | undefined,
      data: row.data || "",
    };
  },

  // "deleted" ist ein Tombstone (utils.js getAbsenzTypes): ein Default-Typ
  // wird per Override-Zeile mit deleted:true "gelöscht" statt entfernt, ein
  // eigener Typ direkt markiert. Ohne dieses Feld kommen gelöschte Typen
  // nach jedem Cloud-Reload zurück.
  absenceType(row: Row) { return { id: row.typeId, label: row.label, color: row.color || "", deleted: !!row.deleted }; },
  letterTemplate(row: Row) { return { id: row.templateId, name: row.name, body: row.body || "" }; },
  // stundenDelta/repeatsYearly sind die Felder, die getFeiertageForYear()
  // tatsächlich braucht — halfDay wird von keiner UI-Stelle gelesen/
  // geschrieben (Altlast, bleibt bestehen, aber ungenutzt).
  holiday(row: Row) { return { date: row.date?.slice(0, 10), label: row.label, halfDay: !!row.halfDay, stundenDelta: row.stundenDelta ?? null, repeatsYearly: !!row.repeatsYearly }; },
  appRole(row: Row) { return { id: row.roleId, name: row.name, permissions: row.permissions ?? null, dashboardTemplateId: row.dashboardTemplateId || "" }; },
  dashboardTemplate(row: Row) { return { id: row.templateId, name: row.name, isPublic: row.isPublic !== false, layout: row.layout, createdBy: row.createdBy || null }; },
};

/** App-Entität → Payload für PocketBase (create/update). */
export const toDB = {
  studioSettings(settings: Partial<Settings> | undefined, studioId: Id) {
    const rest = settings || {};
    return {
      studio: studioId,
      name: rest.name, address: rest.address,
      street: rest.street, zip: rest.zip, city: rest.city, country: rest.country,
      email: rest.email, phone: rest.phone,
      iban: rest.iban, ibanType: rest.ibanType,
      mwstNr: rest.mwst, mwstRate: rest.mwstRate,
      defaultHourlyRate: rest.defaultHourlyRate,
      defaultWochenstunden: rest.defaultWochenstunden,
      defaultFerienWochen: rest.defaultFerienWochen,
      defaultPkAGSatz: rest.defaultPkAGSatz,
      vertragNumberFormat: rest.vertragNumberFormat,
      lastProjectSeq: rest.lastProjectSeq,
      lastProjectYear: rest.lastProjectYear,
      studioBudget: rest.studioBudget || {},
      studioBudgetVersions: rest.studioBudgetVersions || [],
      logo: rest.logo || "",
      formats: {
        projectNumberFormat: rest.projectNumberFormat, invoiceNumberFormat: rest.invoiceNumberFormat,
        quoteNumberFormat: rest.quoteNumberFormat, protocolNumberFormat: rest.protokollNumberFormat,
        deliveryNoteNumberFormat: rest.deliveryNoteNumberFormat,
      },
      pageMargins: {
        pageMarginTop: rest.pageMarginTop, pageMarginBottom: rest.pageMarginBottom,
        pageMarginLeft: rest.pageMarginLeft, pageMarginRight: rest.pageMarginRight,
      },
      // expenseCategories/internalExpenseCategories/closedMonths/blockMaiTag
      // haben keine eigene PB-Spalte — leben im ui-JSON-Blob (siehe fromDB).
      ui: {
        autoPrint: rest.autoPrint, logoSize: rest.logoSize, qrNewPage: rest.qrNewPage, pdfNameFormat: rest.pdfNameFormat,
        expenseCategories: rest.expenseCategories || [], internalExpenseCategories: rest.internalExpenseCategories || [],
        closedMonths: rest.closedMonths || [], blockMaiTag: rest.blockMaiTag !== false,
        // Protokoll-Genehmigung: ohne eigene Spalte im ui-Blob (fromDB übernimmt ...row.ui)
        protokollApproval: rest.protokollApproval, protokollApprovalHours: rest.protokollApprovalHours,
        // Dokument-Design (Schriften/Farben/eigenes CSS) — Dateien liegen separat in docAssets
        docDesign: rest.docDesign,
      },
      protokollTypeAbbr: rest.protokollTypeAbbreviations || {},
    };
  },

  studioRoles(roles: Role[] | undefined, studioId: Id) {
    return (roles || []).map(r => ({ studio: studioId, roleId: r.id, label: r.label, rate: r.rate, sort: r.sort ?? 0 }));
  },

  // Bewusst OHNE studio-Feld: das Setzen/Beibehalten von studio ist Sache des
  // Adapters (_syncPersons) — bei UPDATE einer bereits geteilten Person darf
  // studio nie mitgeschickt werden (würde sie versehentlich re-lokalisieren),
  // bei CREATE einer neuen lokalen Person setzt der Adapter es separat.
  person(p: Person) {
    return {
      id: p.id,
      name: p.name, personType: p.type,
      isAuftraggeber: !!p.isAuftraggeber, isPartner: !!p.isPartner,
      category: p.category || "",
      street: p.street, zip: p.zip, city: p.city, country: p.country,
      email: p.email, phone: p.phone, website: p.website, note: p.note,
      contacts: p.contacts || [], honorarOffers: p.honorarOffers || [],
    };
  },

  project(p: Project, studioId: Id) {
    return {
      id: p.id, studio: studioId,
      number: p.number, name: p.name, client: p.clientId || null,
      category: p.category, billingType: p.billingType || null,
      hourlyRate: p.hourlyRate, budget: p.budget, budgetHours: p.budgetHours,
      status: p.status || "aktiv", description: p.description,
      startDate: p.startDate || null,
      enabledPhases: p.enabledPhases || [], positions: p.positions || [],
      customPhases: p.customPhases || [], projectContacts: p.projectContacts || [],
      internalMembers: p.internalMembers || [],
      linkedQuotes: p.linkedQuotes || [],
      budgetAmount: p.budgetAmount ?? null, phasesBudget: p.phasesBudget || [],
    };
  },

  employee(e: Employee, studioId: Id) {
    return {
      id: e.id, studio: studioId,
      name: e.name, role: e.role, personalNr: e.personalNr,
      adresse: e.adresse, ort: e.ort, ahvNr: e.ahvNr, geburtsdatum: e.geburtsdatum || null,
      email: e.email, eintrittsdatum: e.eintrittsdatum || null,
      pensum: e.pensum, wochenstunden: e.wochenstunden, ferienWochen: e.ferienWochen,
      monatslohn: e.monatslohn, lohnIban: e.lohnIban, dreizehnterLohn: !!e.dreizehnterLohn,
      ahvSatz: e.ahvSatz, alvSatz: e.alvSatz, bvgSatz: e.bvgSatz, nbuSatz: e.nbuSatz, ktgSatz: e.ktgSatz,
      quellensteuerPflichtig: !!e.quellensteuerPflichtig, quellensteuerSatz: e.quellensteuerSatz,
      pkAgSatz: e.pkAGSatz,
      ferienUebertragVorjahr: e.ferienUebertragVorjahr || {},
      appUser: e.appUserId || null,
      active: e.active !== false,
    };
  },

  quote(q: Quote, studioId: Id) {
    return {
      id: q.id, studio: studioId,
      number: q.number, client: q.clientId || null, project: q.projectId || null, projectName: q.projectName,
      date: q.date || null, validUntil: q.validUntil || null,
      mode: q.mode || null, mwst: q.mwst !== false, notes: q.notes,
      status: q.status || "entwurf",
      siaConfig: q.sia || null, manualPhases: q.manualPhases || [],
      freeItems: q.freeItems || [], quoteRoles: q.quoteRoles || [],
      sub: q.sub || 0, totalHours: q.totalHours || 0, tax: q.tax || 0, total: q.total || 0,
      mwstRate: q.mwstRate ?? null,
    };
  },

  contract(v: Contract, studioId: Id) {
    return {
      id: v.id, studio: studioId,
      number: v.number, client: v.clientId || null, project: v.projectId || null, quote: v.quoteId || null,
      contractType: v.contractType || "haupt", legalBasis: v.legalBasis,
      billingType: v.billingType || "pauschal", amount: v.amount || 0, hourlyRate: v.hourlyRate || 0,
      paymentTerms: v.paymentTerms, date: v.date || null, signedDate: v.signedDate || null,
      status: v.status || "entwurf", notes: v.notes,
    };
  },

  invoice(i: Invoice, studioId: Id) {
    return {
      id: i.id, studio: studioId,
      number: i.number, client: i.clientId || null, contactId: i.contactId || "",
      project: i.projectId || null, quote: i.quoteId || null,
      date: i.date || null, dueDate: i.dueDate || null, sentDate: i.sentDate || null, paidDate: i.paidDate || null,
      items: i.items || [], mwst: i.mwst !== false, mwstRate: i.mwstRate, notes: i.notes,
      status: i.status || "entwurf", invoiceKind: i.invoiceKind || null,
      discountType: i.discountType || "none", discountValue: i.discountValue || 0, discountLabel: i.discountLabel,
      entrySelections: i.entrySelections || {}, qrReference: i.qrReference,
      reminders: i.reminders || [],
      sub: i.sub || 0, tax: i.tax || 0, total: i.total || 0,
      subAfterDisc: i.subAfterDisc || 0, globalDisc: i.globalDisc || 0,
    };
  },

  timeEntry(t: TimeEntry, studioId: Id) {
    return {
      id: t.id, studio: studioId,
      employee: t.employeeId || null, project: t.projectId || null,
      phaseId: t.phaseId, positionId: t.positionId,
      date: t.date, minutes: t.minutes, startTime: t.startTime, endTime: t.endTime, description: t.description,
      invoice: t.invoiceId || null,
    };
  },

  expense(e: Expense, studioId: Id) {
    return {
      id: e.id, studio: studioId,
      employee: e.employeeId || null, project: e.projectId || null,
      date: e.date, category: e.category, description: e.description, amount: e.amount,
      mwstRate: e.mwstRate, inclMwst: e.inclMwst !== false, status: e.status || "offen",
      receiptName: e.receiptName, receiptData: e.receiptData || "", lohnEntry: e.lohnEntryId || null,
    };
  },

  internalExpense(e: InternalExpense, studioId: Id) {
    return {
      id: e.id, studio: studioId,
      date: e.date, category: e.category, description: e.description, amount: e.amount,
      mwstRate: e.mwstRate, inclMwst: e.inclMwst !== false,
      recurring: !!e.recurring, recurringInterval: e.recurringInterval || null,
      receiptData: e.receiptData || "", receiptName: e.receiptName || "",
    };
  },

  absence(a: Absence, studioId: Id) {
    return {
      id: a.id, studio: studioId, employee: a.employeeId,
      typeId: a.type, date: a.date || null, dateFrom: a.dateFrom || null, dateTo: a.dateTo || null,
      startTime: a.startTime, endTime: a.endTime, hours: a.hours, minutes: a.minutes,
      note: a.note, status: a.status || "pending",
    };
  },

  vacationEntry(v: FerienEntry, studioId: Id) {
    return {
      id: v.id, studio: studioId, employee: v.employeeId,
      dateFrom: v.dateFrom, dateTo: v.dateTo, note: v.note,
      status: v.status || "pending", originalData: v.originalData || null,
    };
  },

  payrollEntry(p: LohnEntry, studioId: Id) {
    const { id, employeeId, monat, ...rest } = p;
    return { id, studio: studioId, employee: employeeId || null, monat: monat || "", data: rest };
  },

  overtimeClosing(o: OvertimeClosing, studioId: Id) {
    return {
      id: o.id, studio: studioId, employee: o.empId || null,
      year: o.year, date: o.date || null, type: o.type || "payout",
      hoursSettled: o.hoursSettled || 0, zuschlagPercent: o.zuschlagPercent || 0,
      stundenlohn: o.stundenlohn || 0, auszahlungBetrag: o.auszahlungBetrag || 0,
    };
  },

  protocol(p: Protocol, studioId: Id) {
    return {
      id: p.id, studio: studioId,
      number: p.nummer, title: p.title, date: p.date || null,
      time: p.time || "", endTime: p.endTime || "",
      type: p.type || null, location: p.location,
      project: p.projectId || null, projectManual: p.projectManual,
      participants: p.participants || [], traktanden: p.traktanden || [],
      nextDate: p.nextDate || null, verteiler: p.verteiler,
      approval: p.approval || "", approvalHours: p.approvalHours ?? null,
    };
  },

  deliveryNote(d: DeliveryNote, studioId: Id) {
    return {
      id: d.id, studio: studioId,
      number: d.number, date: d.date || null, client: d.clientId || null, clientManual: d.clientManual,
      project: d.projectId || null, projectManual: d.projectManual, deliveryAddress: d.deliveryAddress,
      notes: d.notes, items: d.items || [],
    };
  },

  // weight 0 statt null: PocketBase liefert eine leere Zahl als 0, sonst gälte die Zeile bei jedem Sync als geändert
  docAsset(a: DocAsset, studioId: Id) {
    return { id: a.id, studio: studioId, kind: a.kind, name: a.name, family: a.family || "", weight: a.weight || 0, style: a.style || "", data: a.data };
  },

  blogPost(b: BlogPost, studioId: Id) {
    return {
      id: b.id, studio: studioId, author: b.authorId || null, authorName: b.authorName,
      category: b.type, title: b.title, body: b.body, pinned: !!b.pinned,
      status: b.status || "published", poll: b.poll || null, image: b.image || "",
      eventDate: b.eventDate || null,
    };
  },

  absenceType(t: AbsenzType, studioId: Id) { return { studio: studioId, typeId: t.id, label: t.label, color: t.color, deleted: !!t.deleted }; },
  letterTemplate(t: LetterTemplate, studioId: Id) { return { studio: studioId, templateId: t.id, name: t.name, body: t.body }; },
  holiday(h: Feiertag, studioId: Id) { return { studio: studioId, date: h.date, label: h.label, halfDay: !!h.halfDay, stundenDelta: h.stundenDelta ?? null, repeatsYearly: !!h.repeatsYearly }; },
  appRole(r: AppRole, studioId: Id) { return { studio: studioId, roleId: r.id, name: r.name, permissions: r.permissions ?? null, dashboardTemplateId: r.dashboardTemplateId }; },
  dashboardTemplate(d: DashboardTemplate, studioId: Id) { return { studio: studioId, templateId: d.id, name: d.name, isPublic: d.isPublic !== false, layout: d.layout, createdBy: d.createdBy || null }; },
};
