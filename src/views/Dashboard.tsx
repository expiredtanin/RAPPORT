// Übersicht (Startseite): frei anordenbare Kacheln (Widgets) mit Kennzahlen,
// Projektliste, unverrechneten Stunden, Umsatzverlauf, offenen Offerten, letzten
// Zeiteinträgen, Ferienstand, Pinnwand usw. Die verfügbaren Kacheln stehen in
// `DASHBOARD_WIDGETS` (constants.ts); sie hängen je an einer Berechtigung (`perm`).
//
// Layout-Auflösung (erste Treffer gewinnt):
//   1. persönliches Layout des Nutzers (`user.dashboardWidgets`),
//   2. Vorlage der Rolle (`appRole.dashboardTemplateId` → `data.dashboardTemplates`),
//   3. alle Kacheln (Fallback).
// Ein Layout ist eine Liste von Zeilen (`DashboardRow`: Spaltenzahl, Mindesthöhe, Widget-Ids).
// Im Bearbeitungsmodus lassen sich Kacheln per Drag & Drop verschieben, hinzufügen,
// entfernen; das Ergebnis wird persönlich gespeichert oder als öffentliche/private
// Vorlage abgelegt (Recht «dashboard-vorlage»).
//
// Die Kennzahlen werden bei jedem Render direkt aus `data` berechnet (keine
// gespeicherten Summen). Monatsgrenzen mit reiner UTC-Arithmetik, siehe Kommentar unten.

import React, { useState, useRef, useEffect } from "react";
import { SIA_PHASES, DASHBOARD_WIDGETS, LEAD_STAGES } from "../constants";
import { dueFollowUps, isOpenLead, pipelineValue } from "../crm";
import { formatCHF, formatDate, formatHours, migrateDashboardLayout, widgetsToRows, generateId, getFeiertageForYear, localISODate } from "../utils";
import { KpiCard } from "../components/UI";
import type { AppData, Employee, DashboardRow, DashboardTemplate, TimeEntry, ViewProps } from "../types";

const HEIGHT_OPTS = [
  { v: 0,   l: "Auto" },
  { v: 160, l: "S" },
  { v: 280, l: "M" },
  { v: 420, l: "L" },
];

function deepCloneLayout(layout?: DashboardRow[] | null): DashboardRow[] {
  return (layout || []).map(r => ({ ...r, widgets: [...r.widgets] }));
}

export default function Dashboard({ data, setView, currentUser, userPermissions, saveAll }: Pick<ViewProps, "data" | "setView" | "currentUser" | "userPermissions" | "saveAll">) {
  const today = localISODate();
  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);
  // Reine UTC-Monatsarithmetik (Date.UTC/getUTCMonth/setUTCMonth) — lokales
  // setDate(1)+setMonth() reicht NICHT: an Monatsenden nahe einer Sommerzeit-
  // Umstellung wechselt der 1. eines Nachbarmonats die Zeitzonen-Offset-Regel
  // gegenüber dem Ausgangstag, wodurch toISOString() erneut einen Tag daneben
  // liegen kann (z.B. 31.10. lokal → fälschlich "2026-08" statt "2026-09").
  const lastMonth = (() => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  // ─── Layout resolution ─────────────────────────────────────────────
  const myUser  = (data.users        || []).find(u => u.id === currentUser?.id);
  const myRole  = (data.appRoles     || []).find(r => r.id === (currentUser?.appRoleId || myUser?.appRoleId));
  const myTpl   = (data.dashboardTemplates || []).find(t => t.id === myRole?.dashboardTemplateId);
  const roleLayout  = myTpl
    ? migrateDashboardLayout(myTpl.layout)
    : migrateDashboardLayout(myRole?.dashboardWidgets) // fallback for old data
    || widgetsToRows(DASHBOARD_WIDGETS.map(w => w.id));
  const savedLayout = myUser?.dashboardWidgets ? migrateDashboardLayout(myUser.dashboardWidgets) : null;

  const [editMode, setEditMode]         = useState(false);
  const [layout,   setLayout]           = useState<DashboardRow[]>([]);
  const [dragOver, setDragOver]         = useState<{ rowId: string; before: string | null } | null>(null);
  const [addPopoverRowId, setAddPopoverRowId] = useState<string | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [newPublicName, setNewPublicName] = useState("");
  const [newPrivateName, setNewPrivateName] = useState("");
  const dragRef = useRef<{ widgetId: string; fromRowId: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const activeLayout = editMode ? layout : (savedLayout || roleLayout);

  // ─── Data ──────────────────────────────────────────────────────────
  const activeProjects   = data.projects.filter(p => p.status === "aktiv");
  const projMins  = (id: string)   => data.timeEntries.filter(e => e.projectId === id).reduce((s, e) => s + (e.minutes || 0), 0);
  const monthMins        = data.timeEntries.filter(e => (e.date||"").startsWith(thisMonth)).reduce((s,e)=>s+(e.minutes||0),0);
  const lastMoMins       = data.timeEntries.filter(e => (e.date||"").startsWith(lastMonth)).reduce((s,e)=>s+(e.minutes||0),0);
  const myEmpId          = currentUser?.employeeId;
  // Aggregat über alle Mitarbeitenden nur für Admin/Rollen mit "mitarbeiter"-Recht
  // zeigen (gleiche Regel wie Time.jsx canSwitchEmployee) — sonst sieht ein
  // eingeladener, noch nicht verknüpfter Nutzer versehentlich die Firmen-Summe.
  const canSeeAllEmp     = userPermissions === null || (userPermissions||[]).includes("mitarbeiter");
  const myMonthMins      = data.timeEntries.filter(e => (e.date||"").startsWith(thisMonth) && e.employeeId===myEmpId).reduce((s,e)=>s+(e.minutes||0),0);
  const recentTime       = [...data.timeEntries].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,6);
  const myRecentTime     = [...data.timeEntries].filter(e=>e.employeeId===myEmpId).sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,6);
  const openInvoices     = data.invoices.filter(i => i.status==="gesendet"||i.status==="überfällig");
  const overdueInvoices  = data.invoices.filter(i => i.status==="überfällig");
  const openAmount       = openInvoices.reduce((s,i)=>s+(i.total||0),0);
  const paidThisYear     = data.invoices.filter(i=>i.status==="bezahlt"&&(i.date||"").startsWith(thisYear)).reduce((s,i)=>s+(i.sub||0),0);
  const pendingQuotes    = (data.quotes||[]).filter(q=>q.status==="gesendet");
  const expiredQuotes    = (data.quotes||[]).filter(q=>q.status==="gesendet"&&q.validUntil&&q.validUntil<today);
  const unbilledProjects = activeProjects.map(p=>{
    const mins = data.timeEntries.filter(e=>e.projectId===p.id&&!e.invoiceId).reduce((s,e)=>s+(e.minutes||0),0);
    return {...p, unbilledMins:mins, unbilledAmt:(mins/60)*(p.hourlyRate||0)};
  }).filter(p=>p.unbilledMins>0&&(p.billingType||p.type)==="stundensatz").sort((a,b)=>b.unbilledMins-a.unbilledMins);
  const totalUnbilled    = unbilledProjects.reduce((s,p)=>s+p.unbilledMins,0);
  const last6Months      = (() => {
    const now = new Date();
    return Array.from({length:6},(_,i)=>{
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      d.setUTCMonth(d.getUTCMonth()-(5-i));
      return d.toISOString().slice(0,7);
    });
  })();
  const monthlyRevenue   = last6Months.map(m=>({m,paid:data.invoices.filter(i=>i.status==="bezahlt"&&(i.date||"").startsWith(m)).reduce((s,i)=>s+(i.sub||0),0)}));
  const maxRev           = Math.max(...monthlyRevenue.map(m=>m.paid),1);

  // ─── Permission ────────────────────────────────────────────────────
  // userPermissions === null = Vollzugriff (Admin/uneingeschränkte Rolle,
  // bereits fail-closed in App.jsx aufgelöst) — sonst nur Widgets aus Modulen,
  // auf die die Rolle tatsächlich Zugriff hat (siehe DASHBOARD_WIDGETS.perm).
  const canSaveTemplate = userPermissions === null || userPermissions.includes("dashboard-vorlage");
  const visibleWidgets = userPermissions === null ? DASHBOARD_WIDGETS : DASHBOARD_WIDGETS.filter(w => !w.perm || userPermissions.includes(w.perm));
  const visibleWidgetIds = new Set(visibleWidgets.map(w => w.id));

  // ─── Edit mode ─────────────────────────────────────────────────────
  const enterEdit = () => { setLayout(deepCloneLayout(savedLayout || roleLayout)); setEditMode(true); };
  const cancelEdit = () => { setEditMode(false); setAddPopoverRowId(null); setSaveTemplateOpen(false); setNewPublicName(""); setNewPrivateName(""); };
  const saveEdit = () => {
    if (currentUser && saveAll) {
      const users = (data.users||[]).map(u => u.id===currentUser.id ? {...u, dashboardWidgets: layout} : u);
      saveAll({ ...data, users });
    }
    setEditMode(false); setAddPopoverRowId(null); setSaveTemplateOpen(false); setNewPublicName(""); setNewPrivateName("");
  };
  const loadTemplate = (tplId: string) => {
    const tpl = (data.dashboardTemplates||[]).find(t=>t.id===tplId);
    if (tpl?.layout) setLayout(deepCloneLayout(migrateDashboardLayout(tpl.layout)));
  };
  const saveAsTemplate = (tplId: string) => {
    if (!saveAll) return;
    const dashboardTemplates = (data.dashboardTemplates||[]).map(t => t.id===tplId ? {...t, layout} : t);
    saveAll({ ...data, dashboardTemplates });
    setSaveTemplateOpen(false);
  };
  const createTemplate = (name: string, isPublic: boolean) => {
    if (!name.trim() || !saveAll) return;
    const tpl: DashboardTemplate = { id: generateId(), name: name.trim(), isPublic, layout, ...(!isPublic ? { createdBy: currentUser?.id } : {}) };
    saveAll({ ...data, dashboardTemplates: [...(data.dashboardTemplates||[]), tpl] });
    setSaveTemplateOpen(false);
    if (isPublic) setNewPublicName(""); else setNewPrivateName("");
  };
  // Add widget to row, moving it out of any other row it's already in
  const addWidgetExclusive = (rowId: string, wid: string) => {
    setLayout(l => l.map(r => {
      if (r.id === rowId) return { ...r, widgets: r.widgets.includes(wid) ? r.widgets : [...r.widgets, wid] };
      return { ...r, widgets: r.widgets.filter(w => w !== wid) };
    }));
    setAddPopoverRowId(null);
  };
  // Close popovers on outside click
  useEffect(() => {
    if (!addPopoverRowId && !saveTemplateOpen) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest("[data-popover]")) { setAddPopoverRowId(null); setSaveTemplateOpen(false); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [addPopoverRowId, saveTemplateOpen]);

  // ─── Row operations ────────────────────────────────────────────────
  const updateRow = (rowId: string, patch: Partial<DashboardRow>) => setLayout(l => l.map(r => r.id===rowId ? {...r,...patch} : r));
  const addRow = (afterId: string) => {
    const row: DashboardRow = { id: generateId(), cols: 2, minH: 0, widgets: [] };
    setLayout(l => {
      const i = l.findIndex(r=>r.id===afterId);
      const next = [...l];
      next.splice(i+1, 0, row);
      return next;
    });
  };
  const deleteRow = (rowId: string) => setLayout(l => l.filter(r=>r.id!==rowId));
  const moveRow = (rowId: string, dir: number) => setLayout(l => {
    const i = l.findIndex(r=>r.id===rowId);
    const j = i + dir;
    if (j<0||j>=l.length) return l;
    const next=[...l];
    [next[i],next[j]]=[next[j],next[i]];
    return next;
  });
  const removeWidgetFromRow = (rowId: string, wid: string) =>
    setLayout(l => l.map(r => r.id===rowId ? {...r, widgets:r.widgets.filter(w=>w!==wid)} : r));

  // ─── Drag & Drop ───────────────────────────────────────────────────
  const handleDragStart = (fromRowId: string, widgetId: string) => {
    dragRef.current = { fromRowId, widgetId };
    setDraggingId(widgetId);
  };
  const handleDragEnd = () => {
    dragRef.current = null;
    setDraggingId(null);
    setDragOver(null);
  };
  const handleDrop = (toRowId: string, beforeWidgetId: string | null) => {
    const src = dragRef.current;
    if (!src) return;
    const { fromRowId, widgetId } = src;
    setLayout(l => {
      const next = deepCloneLayout(l);
      const fromRow = next.find(r=>r.id===fromRowId);
      const toRow   = next.find(r=>r.id===toRowId);
      if (!fromRow||!toRow) return l;
      fromRow.widgets = fromRow.widgets.filter(w=>w!==widgetId);
      if (beforeWidgetId) {
        const idx = toRow.widgets.indexOf(beforeWidgetId);
        toRow.widgets.splice(idx<0 ? toRow.widgets.length : idx, 0, widgetId);
      } else {
        if (!toRow.widgets.includes(widgetId)) toRow.widgets.push(widgetId);
      }
      return next;
    });
    dragRef.current = null;
    setDraggingId(null);
    setDragOver(null);
  };

  // ─── Styles ────────────────────────────────────────────────────────
  const ctrlBtn = "pill";
  const activeCtrlBtn = "pill active";

  // ─── Widget content renderers ──────────────────────────────────────
  const wContent: Record<string, () => React.ReactNode> = {
    "kpi-projekte": () => <KpiCard label="AKTIVE PROJEKTE" value={activeProjects.length} color="#b07848" go="projects" setView={!editMode?setView:undefined} sub={`${data.projects.filter(p=>p.status==="abgeschlossen").length} abgeschlossen`} />,
    "kpi-stunden": () => (!myEmpId && !canSeeAllEmp)
      ? <KpiCard label={`STUNDEN ${new Date().toLocaleString("de-CH",{month:"long"}).toUpperCase()}`} value="—" color="var(--positive)" sub="Kein Mitarbeiterprofil verknüpft" />
      : <KpiCard label={`STUNDEN ${new Date().toLocaleString("de-CH",{month:"long"}).toUpperCase()}`} value={formatHours(myEmpId?myMonthMins:monthMins)} color="var(--positive)" go="time" setView={!editMode?setView:undefined} sub={!myEmpId&&lastMoMins>0?`Vormonat: ${formatHours(lastMoMins)}`:undefined} />,
    "kpi-ausstehend": () => <KpiCard label="AUSSTEHEND" value={formatCHF(openAmount)} color={overdueInvoices.length>0?"var(--negative)":"var(--pending)"} go="invoices" setView={!editMode?setView:undefined} sub={overdueInvoices.length>0?`${overdueInvoices.length} überfällig`:`${openInvoices.length} gesendet`} />,
    "kpi-umsatz": () => <KpiCard label="UMSATZ DIESES JAHR" value={formatCHF(paidThisYear)} color="var(--positive)" go="invoices" setView={!editMode?setView:undefined} sub="bezahlt (netto)" />,
    "warnungen": () => {
      // "Warnungen" mischt zwei Berechtigungsbereiche (Rechnungen/Offerten) —
      // hier pro Teilblock statt über DASHBOARD_WIDGETS.perm gaten, sonst
      // sähe ein Nutzer ohne Rechnungs-Recht den ausstehenden CHF-Betrag.
      const canInvoicesWarn = userPermissions === null || userPermissions.includes("invoices");
      const canQuotesWarn = userPermissions === null || userPermissions.includes("quotes");
      const showOverdue = canInvoicesWarn && overdueInvoices.length>0;
      const showExpired = canQuotesWarn && expiredQuotes.length>0;
      const has = showOverdue||showExpired;
      if (!editMode&&!has) return null;
      return has ? (
        <div style={{display:"flex",gap:12,flexWrap:"wrap",height:"100%",alignItems:"stretch"}}>
          {showOverdue&&<div onClick={!editMode?()=>setView("invoices"):undefined} style={{flex:1,minWidth:180,padding:"12px 16px",background:"#fff3f3",border:"1.5px solid #e0b0b0",borderRadius:8,cursor:editMode?"default":"pointer",display:"flex",alignItems:"center",gap:12}}>
            <span className="msr" style={{fontSize:18}}>warning</span>
            <div><div style={{fontSize:12,fontWeight:600,color:"var(--negative)"}}>{overdueInvoices.length} überfällige Rechnung{overdueInvoices.length>1?"en":""}</div><div style={{fontSize:11,color:"var(--warning)",marginTop:2}}>{formatCHF(overdueInvoices.reduce((s,i)=>s+i.total,0))} ausstehend</div></div>
          </div>}
          {showExpired&&<div onClick={!editMode?()=>setView("quotes"):undefined} style={{flex:1,minWidth:180,padding:"12px 16px",background:"#fffbe8",border:"1.5px solid #e0d090",borderRadius:8,cursor:editMode?"default":"pointer",display:"flex",alignItems:"center",gap:12}}>
            <div style={{fontSize:18}}>⏱</div>
            <div><div style={{fontSize:12,fontWeight:600,color:"var(--pending)"}}>{expiredQuotes.length} Offerte{expiredQuotes.length>1?"n":""} abgelaufen</div><div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Gültigkeit überschritten</div></div>
          </div>}
        </div>
      ) : <div className="card" style={{fontSize:12,color:"var(--text5)",fontStyle:"italic"}}>Warnungen (keine aktuellen)</div>;
    },
    "aktive-projekte": () => (
      <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>AKTIVE PROJEKTE</div>
          <button onClick={()=>setView("projects")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Alle →</button>
        </div>
        {activeProjects.length===0?<div style={{fontSize:13,color:"var(--text5)",textAlign:"center",padding:"20px 0"}}>Keine aktiven Projekte</div>:activeProjects.slice(0,6).map(p=>{
          const used=projMins(p.id),budget=p.budgetHours||0,pct=budget>0?Math.min((used/60)/budget,1):0,over=budget>0&&(used/60)>budget;
          const cl=(data.persons||[]).find(c=>c.id===p.clientId);
          return (<div key={p.id} style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid var(--border2)"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <div><div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{p.name}</div>{cl&&<div style={{fontSize:10,color:"var(--text4)",marginTop:1}}>{cl.name}</div>}</div>
              <div style={{textAlign:"right",fontSize:11,color:over?"var(--negative)":"var(--text4)",whiteSpace:"nowrap"}}>{formatHours(used)}{budget>0?` / ${budget}h`:""}</div>
            </div>
            {budget>0&&<div style={{height:3,background:"var(--border2)",borderRadius:2}}><div style={{width:`${pct*100}%`,height:"100%",background:over?"var(--negative)":pct>0.8?"var(--warning)":"var(--positive)",borderRadius:2,transition:"width 0.3s"}}/></div>}
          </div>);
        })}
      </div>
    ),
    "unverrechnete-stunden": () => (
      <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>UNVERRECHNETE STUNDEN</div>
          <button onClick={()=>setView("invoices")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>→</button>
        </div>
        {totalUnbilled===0?<div style={{fontSize:13,color:"var(--positive)",textAlign:"center",padding:"20px 0"}}>✓ Alles verrechnet</div>:<>
          <div style={{fontSize:22,fontFamily:"'Inter', sans-serif",fontWeight:700,color:"var(--warning)",marginBottom:2}}>{formatHours(totalUnbilled)}</div>
          <div style={{fontSize:11,color:"var(--text5)",marginBottom:16}}>≈ {formatCHF(unbilledProjects.reduce((s,p)=>s+p.unbilledAmt,0))}</div>
          {unbilledProjects.slice(0,5).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border2)",fontSize:12}}><span style={{color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"60%"}}>{p.name}</span><span style={{color:"var(--warning)",flexShrink:0}}>{formatHours(p.unbilledMins)}</span></div>)}
        </>}
      </div>
    ),
    "umsatz-sparkline": () => {
      // Kurzform für die Balkenbeschriftung: 63'087 -> «63k», 1'250 -> «1.3k»; exakter Betrag steht im Tooltip.
      const short=(n:number)=>n>=10000?`${Math.round(n/1000)}k`:n>=1000?`${(Math.round(n/100)/10).toLocaleString("de-CH")}k`:String(Math.round(n));
      const total=monthlyRevenue.reduce((s,m)=>s+m.paid,0);
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>UMSATZ LETZTE 6 MONATE</div>
            <div style={{fontSize:11,color:"var(--text4)"}} title="Bezahlte Rechnungen, netto">{formatCHF(total)}</div>
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:8,height:104}}>
            {monthlyRevenue.map(({m,paid})=>(
              <div key={m} style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%",gap:4}}>
                <div style={{fontSize:10,color:paid>0?"var(--text3)":"transparent",fontVariantNumeric:"tabular-nums"}}>{paid>0?short(paid):"–"}</div>
                <div style={{width:"100%",height:paid>0?`${Math.max((paid/maxRev)*64,6)}px`:"2px",background:m===thisMonth?"#b07848":paid>0?"var(--positive)":"var(--border2)",borderRadius:"3px 3px 0 0",transition:"height 0.3s"}} title={`${new Date(m+"-01").toLocaleString("de-CH",{month:"long",year:"numeric"})}: ${formatCHF(paid)}`} />
                <div style={{fontSize:10,color:m===thisMonth?"#b07848":"var(--text4)"}}>{new Date(m+"-01").toLocaleString("de-CH",{month:"short"})}</div>
              </div>
            ))}
          </div>
        </div>
      );
    },
    "offene-offerten": () => (
      <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>OFFENE OFFERTEN</div>
          <button onClick={()=>setView("quotes")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Alle →</button>
        </div>
        {pendingQuotes.length===0?<div style={{fontSize:12,color:"var(--text5)"}}>Keine pendenten Offerten</div>:pendingQuotes.slice(0,5).map(q=>{
          const cl=(data.persons||[]).find(c=>c.id===q.clientId);
          const expired=q.validUntil&&q.validUntil<today;
          return (<div key={q.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border2)",fontSize:12}}>
            <div><div style={{color:expired?"var(--warning)":"var(--text2)"}}>{q.number}</div>{cl&&<div style={{fontSize:10,color:"var(--text5)"}}>{cl.name}</div>}</div>
            <div style={{textAlign:"right",flexShrink:0}}><div style={{color:"var(--text2)",fontWeight:500}}>{formatCHF(q.total)}</div>{expired&&<div style={{fontSize:9,color:"var(--warning)"}}>abgelaufen</div>}</div>
          </div>);
        })}
      </div>
    ),
    "crm-wiedervorlagen": () => {
      const due = dueFollowUps(data, today);
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>WIEDERVORLAGEN</div>
            <button onClick={()=>setView("crm")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Akquise →</button>
          </div>
          {due.length===0?<div style={{fontSize:12,color:"var(--text5)"}}>Keine offenen Wiedervorlagen</div>:due.slice(0,5).map(a=>{
            const p=(data.persons||[]).find(x=>x.id===a.personId);
            return (<div key={a.id} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"5px 0",borderBottom:"1px solid var(--border2)",fontSize:12}}>
              <div style={{minWidth:0}}><div style={{color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p?.name||"—"}</div>{a.note&&<div style={{fontSize:10,color:"var(--text5)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.note}</div>}</div>
              <div style={{flexShrink:0,color:a.overdue?"var(--warning)":"var(--text3)"}}>{formatDate(a.followUpDate as string)}</div>
            </div>);
          })}
        </div>
      );
    },
    "crm-pipeline": () => {
      const leads=data.leads||[];
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>AKQUISE-PIPELINE</div>
            <button onClick={()=>setView("crm")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Alle →</button>
          </div>
          {leads.filter(isOpenLead).length===0?<div style={{fontSize:12,color:"var(--text5)"}}>Keine offenen Leads</div>:<>
            {LEAD_STAGES.filter(st=>st.id!=="gewonnen"&&st.id!=="verloren").map(st=>{
              const inStage=leads.filter(l=>l.stage===st.id);
              return (<div key={st.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border2)",fontSize:12}}>
                <span style={{color:"var(--text2)"}}>{st.label}</span>
                <span style={{color:"var(--text3)"}}>{inStage.length} · {formatCHF(inStage.reduce((s,l)=>s+(l.estimatedValue||0),0))}</span>
              </div>);
            })}
            <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,fontSize:12,fontWeight:600,color:"var(--text)"}}><span>Total netto</span><span>{formatCHF(pipelineValue(leads))}</span></div>
          </>}
        </div>
      );
    },
    "letzte-zeiteintraege": () => (
      <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>LETZTE ZEITEINTRÄGE</div>
          <button onClick={()=>setView("time")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Zeiterfassung →</button>
        </div>
        <TimeTable entries={recentTime} data={data}/>
      </div>
    ),
    "meine-zeiteintraege": () => (
      <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>MEINE ZEITEINTRÄGE</div>
          <button onClick={()=>setView("time")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Zeiterfassung →</button>
        </div>
        <TimeTable entries={myRecentTime} data={data}/>
      </div>
    ),

    "meine-projekte": () => {
      const myProjects = (data.projects||[]).filter(p=>p.status==="aktiv"&&(p.internalMembers||[]).includes(myEmpId as string));
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>MEINE PROJEKTE</div>
            <button onClick={()=>!editMode&&setView("projects")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Alle →</button>
          </div>
          {myProjects.length===0
            ? <div style={{fontSize:13,color:"var(--text5)",textAlign:"center",padding:"20px 0"}}>Keinen Projekten zugewiesen</div>
            : myProjects.map(p=>{
                const myMins=data.timeEntries.filter(e=>e.projectId===p.id&&e.employeeId===myEmpId).reduce((s,e)=>s+(e.minutes||0),0);
                const cl=(data.persons||[]).find(c=>c.id===p.clientId);
                return (
                  <div key={p.id} style={{marginBottom:12,paddingBottom:12,borderBottom:"1px solid var(--border2)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:500,color:"var(--text)"}}>{p.name}</div>
                        {cl&&<div style={{fontSize:10,color:"var(--text4)",marginTop:1}}>{cl.name}</div>}
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",flexShrink:0,marginLeft:8}}>{formatHours(myMins)}</div>
                    </div>
                  </div>
                );
              })
          }
        </div>
      );
    },

    "meine-ferien": () => {
      const myEmp=(data.employees||[]).find(e=>e.id===myEmpId);
      if(!myEmpId||!myEmp) return <div className="card" style={{height:"100%",boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--text5)"}}>Kein Mitarbeiterprofil verknüpft</div>;
      const pensum=(myEmp.pensum||100)/100;
      const anspruchTage=(myEmp.ferienWochen||5)*5*pensum;
      const approvedEntries=(data.ferienEntries||[]).filter(f=>f.employeeId===myEmpId&&(f.status==="approved"||!f.status)&&(f.dateFrom||"").startsWith(thisYear));
      // Feiertage müssen über getFeiertageForYear aufgelöst werden — die Standard-
      // Feiertage (Settings.jsx "Standard-Feiertage hinzufügen") sind alle mit
      // repeatsYearly:true und Basisjahr 2000 abgelegt; ein direkter date-Vergleich
      // gegen data.feiertage matcht dann in keinem anderen Jahr, wodurch Weihnachten,
      // Neujahr etc. hier fälschlich als normale Arbeitstage gezählt würden.
      const ftsThisYear=getFeiertageForYear(data.feiertage||[], parseInt(thisYear,10));
      const countWorkdays=(from: string,to: string)=>{
        // Reine UTC-Arithmetik — lokale Date-Methoden gemischt mit Datums-
        // Vergleichen drifteten um die Sommerzeit-Umstellung auseinander.
        let n=0;const d=new Date(`${from}T00:00:00Z`);const end=new Date(`${to}T00:00:00Z`);
        while(d<=end){
          const dow=d.getUTCDay();
          const ds=d.toISOString().slice(0,10);
          const isFullHoliday=ftsThisYear.some(ft=>ft.date===ds&&(ft.stundenDelta===0||ft.stundenDelta===null||ft.stundenDelta===undefined));
          if(dow!==0&&dow!==6&&!isFullHoliday)n++;
          d.setUTCDate(d.getUTCDate()+1);
        }
        return n;
      };
      const bezogenTage=approvedEntries.reduce((s,f)=>s+countWorkdays(f.dateFrom,f.dateTo),0);
      const restTage=anspruchTage-bezogenTage;
      const pct=Math.min(bezogenTage/anspruchTage,1);
      const upcoming=(data.ferienEntries||[]).filter(f=>f.employeeId===myEmpId&&(f.status==="approved"||!f.status)&&f.dateFrom>today).slice(0,2);
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)",marginBottom:14}}>FERIENSTAND {thisYear}</div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:22,fontFamily:"'Inter', sans-serif",fontWeight:700,color:"var(--positive)"}}>{restTage}</div>
              <div style={{fontSize:10,color:"var(--text4)"}}>Verbleibend</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:22,fontFamily:"'Inter', sans-serif",fontWeight:700,color:"var(--text)"}}>{bezogenTage}</div>
              <div style={{fontSize:10,color:"var(--text4)"}}>Bezogen</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:22,fontFamily:"'Inter', sans-serif",fontWeight:700,color:"var(--text3)"}}>{anspruchTage}</div>
              <div style={{fontSize:10,color:"var(--text4)"}}>Anspruch</div>
            </div>
          </div>
          <div style={{height:4,background:"var(--border2)",borderRadius:2,margin:"12px 0 14px"}}>
            <div style={{width:`${pct*100}%`,height:"100%",background:restTage<5?"var(--negative)":"var(--positive)",borderRadius:2,transition:"width 0.4s"}}/>
          </div>
          {upcoming.length>0&&<>
            <div style={{fontSize:9,letterSpacing:"0.1em",color:"var(--text4)",marginBottom:6}}>NÄCHSTE FERIEN</div>
            {upcoming.map(f=><div key={f.id} style={{fontSize:11,color:"var(--text2)",marginBottom:3}}>{formatDate(f.dateFrom)} – {formatDate(f.dateTo)}</div>)}
          </>}
        </div>
      );
    },

    "ueberstunden": () => {
      const myEmp=(data.employees||[]).find(e=>e.id===myEmpId);
      if(!myEmpId||!myEmp) return <div className="card" style={{height:"100%",boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--text5)"}}>Kein Mitarbeiterprofil verknüpft</div>;
      const pensum=(myEmp.pensum||100)/100;
      const tagessollH=((myEmp.wochenstunden||35)*pensum)/5;
      const startOfYear=`${thisYear}-01-01`;
      // getFeiertageForYear löst repeatsYearly-Feiertage (Standard-Feiertage sind alle
      // mit Basisjahr 2000 abgelegt, siehe Settings.jsx) auf das aktuelle Jahr auf —
      // ein direkter Vergleich gegen data.feiertage würde in jedem Jahr ausser 2000
      // keinen Treffer finden und Feiertage fälschlich als normale Arbeitstage zählen.
      const fts=getFeiertageForYear(data.feiertage||[], parseInt(thisYear,10));
      // Respect eintrittsdatum: only count from when the employee actually started
      const effectiveYearStart=myEmp.eintrittsdatum&&myEmp.eintrittsdatum>startOfYear?myEmp.eintrittsdatum:startOfYear;
      const todayD=new Date(`${today}T00:00:00Z`);
      let workdays=0;const d=new Date(`${effectiveYearStart}T00:00:00Z`);
      while(d<=todayD){const dow=d.getUTCDay();const ds=d.toISOString().slice(0,10);const ft=fts.find(f=>f.date===ds);const isFt=ft&&(ft.stundenDelta===0||ft.stundenDelta===null||ft.stundenDelta===undefined);if(dow!==0&&dow!==6&&!isFt)workdays++;d.setUTCDate(d.getUTCDate()+1);}
      const sollMin=workdays*tagessollH*60;
      const istMin=data.timeEntries.filter(e=>e.employeeId===myEmpId&&(e.date||"")>=effectiveYearStart&&(e.date||"")<=today).reduce((s,e)=>s+(e.minutes||0),0);
      const deltaMin=istMin-sollMin;
      const isPos=deltaMin>=0;
      // This month — also respect eintrittsdatum
      const effectiveMonthStart=myEmp.eintrittsdatum&&myEmp.eintrittsdatum>`${thisMonth}-01`?myEmp.eintrittsdatum:`${thisMonth}-01`;
      const sollMonthMin=(() => {
        const [my,mm]=thisMonth.split("-").map(Number);
        let wd=0;const me=new Date(Date.UTC(my,mm,0)); // Tag 0 des Folgemonats = letzter Tag dieses Monats
        const end=me<todayD?me:todayD;const dd=new Date(`${effectiveMonthStart}T00:00:00Z`);
        while(dd<=end){const dow=dd.getUTCDay();const ds=dd.toISOString().slice(0,10);const ft=fts.find(f=>f.date===ds);const isFt=ft&&(ft.stundenDelta===0||ft.stundenDelta===null||ft.stundenDelta===undefined);if(dow!==0&&dow!==6&&!isFt)wd++;dd.setUTCDate(dd.getUTCDate()+1);}
        return wd*tagessollH*60;
      })();
      const istMonthMin=data.timeEntries.filter(e=>e.employeeId===myEmpId&&(e.date||"").startsWith(thisMonth)).reduce((s,e)=>s+(e.minutes||0),0);
      const deltaMonth=istMonthMin-sollMonthMin;
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)",marginBottom:14}}>STUNDENSALDO</div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,color:"var(--text4)",marginBottom:4}}>JAHRESSALDO {thisYear}</div>
            <div style={{fontSize:26,fontFamily:"'Inter', sans-serif",fontWeight:700,color:isPos?"var(--positive)":"var(--negative)"}}>
              {isPos?"+":""}{formatHours(Math.abs(deltaMin))}
              <span style={{fontSize:13,fontWeight:400,marginLeft:4}}>{isPos?"Überstunden":"Minusstunden"}</span>
            </div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{formatHours(istMin)} von {formatHours(sollMin)} Soll</div>
          </div>
          <div style={{paddingTop:12,borderTop:"1px solid var(--border2)"}}>
            <div style={{fontSize:10,color:"var(--text4)",marginBottom:4}}>DIESER MONAT</div>
            <div style={{fontSize:14,fontWeight:600,color:deltaMonth>=0?"var(--positive)":"var(--negative)"}}>
              {deltaMonth>=0?"+":""}{formatHours(Math.abs(deltaMonth))}
            </div>
            <div style={{fontSize:11,color:"var(--text4)"}}>{formatHours(istMonthMin)} von {formatHours(sollMonthMin)} Soll</div>
          </div>
        </div>
      );
    },

    "stunden-woche": () => {
      if (!myEmpId && !canSeeAllEmp) return <div className="card" style={{height:"100%",boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--text5)"}}>Kein Mitarbeiterprofil verknüpft</div>;
      const myEmp=(data.employees||[]).find(e=>e.id===myEmpId);
      const pensum=(myEmp?.pensum||100)/100;
      const sollH=(myEmp?.wochenstunden||35)*pensum;
      // Reine UTC-Arithmetik — lokale getDay()/setDate() gemischt mit den
      // daraus abgeleiteten toISOString()-Datumsstrings driftete um die
      // Sommerzeit-Umstellung im Oktober auseinander (falsche Wochenfenster).
      const getMonday=(dateStr: string)=>{const d=new Date(`${dateStr}T00:00:00Z`);const day=d.getUTCDay();d.setUTCDate(d.getUTCDate()-(day===0?6:day-1));return d;};
      const monday=getMonday(today);
      const weeks=Array.from({length:5},(_,i)=>{
        const mon=new Date(monday);mon.setUTCDate(mon.getUTCDate()-(4-i)*7);
        const sun=new Date(mon);sun.setUTCDate(sun.getUTCDate()+6);
        const monStr=mon.toISOString().slice(0,10);
        const sunStr=sun.toISOString().slice(0,10);
        const isCurrent=i===4;
        const mins=(myEmpId?data.timeEntries.filter(e=>e.employeeId===myEmpId&&e.date>=monStr&&e.date<=sunStr):data.timeEntries.filter(e=>e.date>=monStr&&e.date<=sunStr)).reduce((s,e)=>s+(e.minutes||0),0);
        const kw=(() => { const d2=new Date(mon);d2.setHours(0,0,0,0);d2.setDate(d2.getDate()+3-(d2.getDay()||7)+1); const w1=new Date(d2.getFullYear(),0,4);return 1+Math.round(((d2.getTime()-w1.getTime())/86400000+((w1.getDay()||7)-1))/7); })();
        return {kw,mins,isCurrent};
      });
      const maxMins=Math.max(...weeks.map(w=>w.mins),sollH*60,1);
      const sollPct=(sollH*60)/maxMins;
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)",marginBottom:14}}>STUNDEN PRO WOCHE</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:8,height:80,position:"relative"}}>
            <div style={{position:"absolute",bottom:`${sollPct*100}%`,left:0,right:0,borderTop:"1px dashed var(--border3)",pointerEvents:"none"}} title={`Soll: ${sollH}h`}/>
            {weeks.map(({kw,mins,isCurrent})=>{
              const pct=mins/maxMins;
              const over=mins>sollH*60;
              return (
                <div key={kw} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontSize:9,color:over?"var(--positive)":"var(--text4)"}}>{mins>0?formatHours(mins):""}</div>
                  <div style={{width:"100%",height:`${Math.max(pct*72,mins>0?4:1)}px`,background:isCurrent?(over?"var(--positive)":"#b07848"):over?"#2d6a4f33":"var(--border2)",borderRadius:"3px 3px 0 0",transition:"height 0.3s"}}/>
                  <div style={{fontSize:9,color:isCurrent?"var(--text2)":"var(--text5)",fontWeight:isCurrent?600:400}}>KW{kw}</div>
                </div>
              );
            })}
          </div>
          <div style={{marginTop:10,fontSize:10,color:"var(--text4)"}}>
            — Soll: {sollH}h / Woche
          </div>
        </div>
      );
    },

    "interner-blog": () => {
      const posts = (data.blogPosts || []);
      const recent = [...posts].sort((a,b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      }).slice(0, 3);
      const getMonday = (dateStr: string) => { const dd=new Date(`${dateStr}T00:00:00Z`); dd.setUTCDate(dd.getUTCDate()-(dd.getUTCDay()===0?6:dd.getUTCDay()-1)); return dd; };
      const weekStart = getMonday(today);
      const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
      const weekStartStr = weekStart.toISOString().slice(0,10);
      const weekEndStr = weekEnd.toISOString().slice(0,10);
      // repeatsYearly-Feiertage über getFeiertageForYear auflösen (siehe "ueberstunden"-
      // Widget oben) — sonst matcht der Datumsvergleich nie ausser im Basisjahr 2000.
      // Jahresgrenze der Woche (z.B. 29.12.–4.1.) berücksichtigen: ggf. zwei Jahre auflösen.
      const weekYears = new Set([weekStart.getUTCFullYear(), weekEnd.getUTCFullYear()]);
      const feiertageWeek = [...weekYears].flatMap(y => getFeiertageForYear(data.feiertage||[], y))
        .filter(f=>f.date>=weekStartStr&&f.date<=weekEndStr);
      const TYPE_COLOR: Record<string, string> = { beitrag:"var(--info)", ankuendigung:"var(--warning)", event:"var(--positive)" };
      const TYPE_LABEL: Record<string, string> = { beitrag:"Beitrag", ankuendigung:"Ankündigung", event:"Event" };
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)"}}>PINNWAND</div>
            <button onClick={()=>!editMode&&setView("pinnwand")} style={{background:"none",border:"none",fontSize:11,color:"var(--text4)",cursor:"pointer",fontFamily:"inherit"}}>Alle →</button>
          </div>
          {feiertageWeek.length>0&&(
            <div style={{padding:"8px 12px",background:"var(--positive-bg)",border:"1px solid #a8d8b8",borderRadius:8,marginBottom:12,fontSize:11,color:"var(--positive)",display:"flex",gap:8,alignItems:"center"}}>
              <span>🎉</span>
              <span><b>Feiertag diese Woche:</b> {feiertageWeek.map(f=>f.label).join(", ")}</span>
            </div>
          )}
          {recent.length===0
            ? <div style={{fontSize:13,color:"var(--text5)",textAlign:"center",padding:"16px 0"}}>Keine Beiträge</div>
            : recent.map(p=>(
              <div key={p.id} style={{marginBottom:12,paddingBottom:12,borderBottom:"1px solid var(--border2)"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{fontSize:9,fontWeight:600,color:TYPE_COLOR[p.type]||"var(--info)",letterSpacing:"0.06em"}}>{(TYPE_LABEL[p.type]||"").toUpperCase()}</span>
                  {p.pinned&&<span className="msr" style={{fontSize:12,color:"#b07848"}}>push_pin</span>}
                </div>
                {p.title&&<div style={{fontSize:13,fontWeight:500,color:"var(--text)",marginBottom:2}}>{p.title}</div>}
                <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{p.body}</div>
                <div style={{fontSize:10,color:"var(--text4)",marginTop:4}}>{p.authorName} · {new Date(p.createdAt).toLocaleDateString("de-CH")}</div>
              </div>
            ))
          }
        </div>
      );
    },

    "team-auslastung": () => {
      // Feldname ist "active" (siehe employee-Mapper/Employees.jsx), nicht
      // "aktiv" — bislang folgenlos, weil nichts e.aktiv je setzt (immer
      // undefined !== false = true), aber divergiert sobald ein Deaktivieren-
      // Toggle dazukommt.
      const activeEmps=(data.employees||[]).filter(e=>e.active!==false);
      const pensum=(e: Employee)=>(e.pensum||100)/100;
      const sollH=(e: Employee)=>((e.wochenstunden||35)*pensum(e))/5*(() => {
        // Reine UTC-Arithmetik — "end" wurde bisher lokal konstruiert, "dd"
        // UTC-verankert, wodurch der letzte Tag jedes Monats in den meisten
        // Monaten verloren ging (nicht nur bei DST-Umstellungen).
        const [my,mm]=thisMonth.split("-").map(Number);
        let wd=0;const d=new Date(Date.UTC(my,mm-1,1));const end=new Date(Date.UTC(my,mm,0));const todayD=new Date(`${today}T00:00:00Z`);
        const cap=end<todayD?end:todayD;const dd=new Date(d);
        while(dd<=cap){const dow=dd.getUTCDay();if(dow!==0&&dow!==6)wd++;dd.setUTCDate(dd.getUTCDate()+1);}
        return wd;
      })();
      const empData=activeEmps.map(e=>{
        const istMin=data.timeEntries.filter(t=>t.employeeId===e.id&&(t.date||"").startsWith(thisMonth)).reduce((s,t)=>s+(t.minutes||0),0);
        const sollMin=sollH(e)*60;
        const pct=sollMin>0?Math.min(istMin/sollMin,1.5):0;
        return{...e,istMin,sollMin,pct};
      }).sort((a,b)=>b.istMin-a.istMin);
      return (
        <div className="card" style={{height:"100%",boxSizing:"border-box"}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.1em",color:"var(--text4)",marginBottom:14}}>TEAM-AUSLASTUNG {new Date().toLocaleString("de-CH",{month:"long"}).toUpperCase()}</div>
          {empData.length===0
            ? <div style={{fontSize:13,color:"var(--text5)"}}>Keine Mitarbeitenden</div>
            : empData.map(e=>{
                const over=e.pct>1;
                return (
                  <div key={e.id} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <div style={{fontSize:12,color:"var(--text)"}}>{e.name}</div>
                      <div style={{fontSize:11,color:over?"var(--positive)":"var(--text4)",fontWeight:over?600:400}}>{formatHours(e.istMin)}{e.sollMin>0?` / ${formatHours(e.sollMin)}`:""}</div>
                    </div>
                    <div style={{height:3,background:"var(--border2)",borderRadius:2}}>
                      <div style={{width:`${Math.min(e.pct,1)*100}%`,height:"100%",background:over?"var(--positive)":e.pct>0.8?"#b07848":"var(--border3)",borderRadius:2,transition:"width 0.3s"}}/>
                    </div>
                  </div>
                );
              })
          }
        </div>
      );
    },
  };

  // ─── Row renderer ──────────────────────────────────────────────────
  const renderRow = (row: DashboardRow, rowIdx: number) => {
    const isDragOverRow = dragOver?.rowId === row.id && dragOver?.before === null;

    return (
      <div key={row.id} style={{marginBottom:16}}>
        {/* Row toolbar */}
        {editMode && (
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:"var(--text4)",letterSpacing:"0.08em"}}>SPALTEN</span>
            {[1,2,3,4].map(n=>(
              <button key={n} onClick={()=>updateRow(row.id,{cols:n})} className={row.cols===n?activeCtrlBtn:ctrlBtn}>{n}</button>
            ))}
            <span style={{fontSize:10,color:"var(--text4)",letterSpacing:"0.08em",marginLeft:6}}>HÖHE</span>
            {HEIGHT_OPTS.map(opt=>(
              <button key={opt.v} onClick={()=>updateRow(row.id,{minH:opt.v})} className={row.minH===opt.v?activeCtrlBtn:ctrlBtn}>{opt.l}</button>
            ))}
            <div data-popover style={{position:"relative",marginLeft:6}}>
              <button onClick={()=>setAddPopoverRowId(addPopoverRowId===row.id?null:row.id)} className={addPopoverRowId===row.id?activeCtrlBtn:ctrlBtn}>+ Widget</button>
              {addPopoverRowId===row.id&&(
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:200,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"6px 0",minWidth:230,boxShadow:"0 4px 20px rgba(0,0,0,0.15)"}}>
                  {visibleWidgets.map(d=>{
                    const inThis=row.widgets.includes(d.id);
                    const inOther=!inThis&&layout.some(r=>r.id!==row.id&&r.widgets.includes(d.id));
                    return (
                      <button key={d.id} onClick={()=>!inThis&&addWidgetExclusive(row.id,d.id)}
                        style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"7px 14px",background:"none",border:"none",color:inThis?"var(--text4)":"var(--text)",cursor:inThis?"default":"pointer",fontFamily:"inherit",fontSize:12,textAlign:"left"}}>
                        <span style={{width:14,textAlign:"center",fontSize:10,opacity:0.5,flexShrink:0}}>{inThis?"✓":"+"}</span>
                        <span style={{flex:1}}>{d.label}</span>
                        {inOther&&<span style={{fontSize:9,color:"var(--text5)"}}>verschieben</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:4}}>
              {rowIdx>0&&<button onClick={()=>moveRow(row.id,-1)} className={ctrlBtn}>↑</button>}
              {rowIdx<layout.length-1&&<button onClick={()=>moveRow(row.id,1)} className={ctrlBtn}>↓</button>}
              <button onClick={()=>addRow(row.id)} className={ctrlBtn}>+ Zeile</button>
              <button onClick={()=>deleteRow(row.id)} className={ctrlBtn} style={{color:"var(--negative)"}}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
            </div>
          </div>
        )}

        {/* Row grid */}
        <div
          className="dashboard-row" data-cols={row.cols}
          style={{
            display:"grid",
            gridTemplateColumns:`repeat(${row.cols},minmax(0,1fr))`,
            gap:16,
            minHeight:row.minH||undefined,
            alignItems:"stretch",
            outline: isDragOverRow&&editMode ? "2px dashed var(--text)" : "none",
            borderRadius:10,
            transition:"outline 0.1s",
          }}
          onDragOver={editMode?e=>{e.preventDefault();setDragOver({rowId:row.id,before:null});}:undefined}
          onDrop={editMode?e=>{e.preventDefault();handleDrop(row.id,null);}:undefined}
        >
          {row.widgets.map(wid=>{
            const content = wContent[wid];
            if (!content || !visibleWidgetIds.has(wid)) return null;
            const rendered = content();
            if (rendered===null&&!editMode) return null;
            const isBefore = dragOver?.rowId===row.id&&dragOver?.before===wid;
            const isDragging = draggingId===wid;
            return (
              <div
                key={wid}
                draggable={editMode}
                onDragStart={editMode?()=>handleDragStart(row.id,wid):undefined}
                onDragEnd={editMode?handleDragEnd:undefined}
                onDragOver={editMode?e=>{e.preventDefault();e.stopPropagation();setDragOver({rowId:row.id,before:wid});}:undefined}
                onDrop={editMode?e=>{e.preventDefault();e.stopPropagation();handleDrop(row.id,wid);}:undefined}
                style={{
                  position:"relative",
                  height:"100%",
                  opacity:isDragging?0.35:1,
                  boxShadow:isBefore?"inset 3px 0 0 var(--text)":undefined,
                  borderRadius:10,
                  cursor:editMode?"grab":"default",
                  transition:"opacity 0.15s",
                }}
              >
                {rendered===null?<div className="card" style={{fontSize:12,color:"var(--text5)",fontStyle:"italic",height:"100%",boxSizing:"border-box",display:"flex",alignItems:"center",justifyContent:"center"}}>{DASHBOARD_WIDGETS.find(d=>d.id===wid)?.label}</div>:rendered}
                {editMode&&(
                  <button
                    onClick={()=>removeWidgetFromRow(row.id,wid)}
                    className={ctrlBtn} style={{position:"absolute",top:8,right:8,zIndex:10,color:"var(--negative)",lineHeight:1,padding:"2px 6px"}}
                    onMouseDown={e=>e.stopPropagation()}
                  >×</button>
                )}
              </div>
            );
          })}

          {/* Empty slot drop target */}
          {editMode&&(
            <div
              onDragOver={e=>{e.preventDefault();setDragOver({rowId:row.id,before:null});}}
              onDrop={e=>{e.preventDefault();handleDrop(row.id,null);}}
              style={{minHeight:80,border:"1.5px dashed var(--border3)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text5)",fontSize:13}}
            >
              ablegen
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:28,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <h1 style={{fontFamily:"'Inter', sans-serif",fontSize:30,fontWeight:400,letterSpacing:"-0.02em",lineHeight:1.1,color:"var(--text)"}}>
            {data.settings.name||"Studio"}
          </h1>
          <div style={{fontSize:11,color:"var(--text4)",letterSpacing:"0.1em",marginTop:6}}>
            {new Date().toLocaleDateString("de-CH",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase()}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginTop:6,flexShrink:0}}>
          {editMode?(
            <>
              <select defaultValue="" onChange={e=>{if(e.target.value){loadTemplate(e.target.value);e.target.value="";}}} className={ctrlBtn}>
                <option value="">Vorlage laden…</option>
                {(data.dashboardTemplates||[]).filter(t=>t.isPublic).map(t=>(
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
                {(data.dashboardTemplates||[]).filter(t=>!t.isPublic&&t.createdBy===currentUser?.id).map(t=>(
                  <option key={t.id} value={t.id}>{t.name} (persönlich)</option>
                ))}
              </select>
              <div data-popover style={{position:"relative"}}>
                <button onClick={()=>setSaveTemplateOpen(v=>!v)} className={saveTemplateOpen?activeCtrlBtn:ctrlBtn}>Vorlage speichern…</button>
                {saveTemplateOpen&&(
                  <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,zIndex:200,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,minWidth:240,boxShadow:"0 4px 20px rgba(0,0,0,0.15)",overflow:"hidden"}}>
                    {canSaveTemplate&&(<>
                      <div style={{padding:"8px 14px 4px",fontSize:9,color:"var(--text4)",letterSpacing:"0.1em",fontWeight:600}}>ÖFFENTLICHE VORLAGE</div>
                      {(data.dashboardTemplates||[]).filter(t=>t.isPublic).map(t=>(
                        <button key={t.id} onClick={()=>saveAsTemplate(t.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",padding:"6px 14px",background:"none",border:"none",color:"var(--text)",cursor:"pointer",fontFamily:"inherit",fontSize:12,textAlign:"left"}}>
                          <span>{t.name}</span><span style={{fontSize:9,color:"var(--text5)"}}>überschreiben</span>
                        </button>
                      ))}
                      <div style={{padding:"6px 14px 10px"}}>
                        <div style={{display:"flex",gap:5}}>
                          <input value={newPublicName} onChange={e=>setNewPublicName(e.target.value)} placeholder="Neue öffentliche Vorlage…"
                            onKeyDown={e=>e.key==="Enter"&&createTemplate(newPublicName,true)}
                            style={{flex:1,height:26,border:"1px solid var(--border)",borderRadius:4,padding:"0 8px",fontSize:11,background:"var(--surface)",color:"var(--text)",fontFamily:"inherit",outline:"none"}} />
                          <button onClick={()=>createTemplate(newPublicName,true)} className={ctrlBtn}>+</button>
                        </div>
                      </div>
                      <div style={{height:1,background:"var(--border)"}}/>
                    </>)}
                    <div style={{padding:"8px 14px 4px",fontSize:9,color:"var(--text4)",letterSpacing:"0.1em",fontWeight:600}}>PERSÖNLICHE VORLAGE</div>
                    {(data.dashboardTemplates||[]).filter(t=>!t.isPublic&&t.createdBy===currentUser?.id).map(t=>(
                      <button key={t.id} onClick={()=>saveAsTemplate(t.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",padding:"6px 14px",background:"none",border:"none",color:"var(--text)",cursor:"pointer",fontFamily:"inherit",fontSize:12,textAlign:"left"}}>
                        <span>{t.name}</span><span style={{fontSize:9,color:"var(--text5)"}}>überschreiben</span>
                      </button>
                    ))}
                    <div style={{padding:"6px 14px 10px"}}>
                      <div style={{display:"flex",gap:5}}>
                        <input value={newPrivateName} onChange={e=>setNewPrivateName(e.target.value)} placeholder="Neue persönliche Vorlage…"
                          onKeyDown={e=>e.key==="Enter"&&createTemplate(newPrivateName,false)}
                          style={{flex:1,height:26,border:"1px solid var(--border)",borderRadius:4,padding:"0 8px",fontSize:11,background:"var(--surface)",color:"var(--text)",fontFamily:"inherit",outline:"none"}} />
                        <button onClick={()=>createTemplate(newPrivateName,false)} className={ctrlBtn}>+</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={cancelEdit} className={ctrlBtn}>Abbrechen</button>
              <button onClick={saveEdit} className="btn btn-primary" style={{fontSize:11}}>Speichern</button>
            </>
          ):(
            <button onClick={enterEdit} className={ctrlBtn} style={{display:"flex",alignItems:"center",gap:5}}>
              <span className="msr" style={{fontSize:13,verticalAlign:"middle"}}>edit</span>
              Anpassen
            </button>
          )}
        </div>
      </div>

      {/* Edit banner */}
      {editMode&&(
        <div style={{padding:"10px 16px",background:"var(--bg2)",border:"1px dashed var(--border3)",borderRadius:8,marginBottom:20,fontSize:12,color:"var(--text4)"}}>
          Dashboard anpassen — Spaltenanzahl und Höhe pro Zeile wählen. Widgets per Drag &amp; Drop verschieben oder mit × entfernen.
        </div>
      )}

      {/* Rows */}
      {(activeLayout || []).map((row,idx) => renderRow(row,idx))}

      {/* Edit mode: add first row / add row at bottom */}
      {editMode&&(
        <div style={{marginTop:8}}>
          <button onClick={()=>addRow(layout[layout.length-1]?.id||"")} className={ctrlBtn} style={{width:"100%",padding:"10px",textAlign:"center",borderStyle:"dashed",color:"var(--text4)"}}>
            + Neue Zeile hinzufügen
          </button>
        </div>
      )}
    </div>
  );
}

function TimeTable({entries,data}: { entries: TimeEntry[]; data: AppData }) {
  if (!entries.length) return <div style={{fontSize:13,color:"var(--text5)",padding:"8px 0"}}>Noch keine Zeiteinträge</div>;
  return (
    <table>
      <thead><tr><th>Datum</th><th>Projekt</th><th>Beschreibung</th><th style={{textAlign:"right"}}>Dauer</th></tr></thead>
      <tbody>
        {entries.map(e=>{
          const proj=data.projects.find(p=>p.id===e.projectId);
          const phase=SIA_PHASES.find(ph=>ph.id===e.phaseId);
          return (<tr key={e.id}>
            <td>{formatDate(e.date)}</td>
            <td><div style={{color:"var(--text)"}}>{proj?.name||"—"}</div>{phase&&<div style={{fontSize:10,color:"var(--text5)"}}>Phase {phase.id}</div>}</td>
            <td style={{color:"var(--text3)"}}>{e.description||"—"}</td>
            <td style={{textAlign:"right",fontWeight:500}}>{formatHours(e.minutes)}</td>
          </tr>);
        })}
      </tbody>
    </table>
  );
}
