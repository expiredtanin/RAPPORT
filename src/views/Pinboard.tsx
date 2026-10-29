// Pinnwand: interne Beiträge, Ankündigungen und Events des Studios, optional mit
// Bild (als Data-URL, auf 1200 px verkleinert) und Umfrage (eine Stimme pro Person).
// Daten in `data.blogPosts`. Nutzer mit Berechtigung «pinnwand-schreiben» (oder
// Administratoren) dürfen Beiträge erstellen; bearbeiten/löschen nur eigene Beiträge
// bzw. alle als Administrator; anpinnen nur Administratoren. Entwürfe sieht nur ihr
// Autor (und Administratoren). Über der Liste erscheint ein Hinweis, wenn diese Woche
// ein Feiertag liegt.

import React, { useState, useRef } from "react";
import { generateId, getFeiertageForYear, imageFileToJpeg, localISODate } from "../utils";
import type { BlogPost, CurrentUser, AppData, Poll, ViewProps } from "../types";

type PostForm = Partial<BlogPost> & Pick<BlogPost, "title" | "body" | "type" | "pinned"> & { eventDate: string; image: string; poll: Poll | null };

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  beitrag:      { label: "Beitrag",       color: "var(--info)", bg: "var(--info-bg)" },
  ankuendigung: { label: "Ankündigung",   color: "var(--warning)", bg: "var(--warning-bg)" },
  event:        { label: "Event",         color: "var(--positive)", bg: "var(--positive-bg)" },
};

/** Darf der Nutzer Beiträge schreiben? Administratoren und Rollen mit `permissions === null` oder «pinnwand-schreiben». */
function canWriteCheck(currentUser: CurrentUser | null | undefined, data: AppData) {
  const myUser  = (data.users   || []).find(u => u.id === currentUser?.id);
  const myRole  = (data.appRoles|| []).find(r => r.id === (currentUser?.appRoleId || myUser?.appRoleId));
  return currentUser?.role === "admin" || myRole?.permissions === null || (myRole?.permissions || []).includes("pinnwand-schreiben");
}

// ─── Poll bar ─────────────────────────────────────────────────────────────────
function PollBlock({ poll, postId, currentUserId, onVote }: {
  poll?: Poll | null; postId: string; currentUserId?: string; onVote: (postId: string, optionId: string) => void;
}) {
  if (!poll) return null;
  const total = Object.keys(poll.votes || {}).length;
  const myVote = currentUserId ? poll.votes?.[currentUserId] : undefined;
  const hasVoted = !!myVote;
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>{poll.question}</div>
      {poll.options.map(opt => {
        const count = Object.values(poll.votes || {}).filter(v => v === opt.id).length;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isMyVote = myVote === opt.id;
        return (
          <div key={opt.id} style={{ marginBottom: 8 }}>
            {!hasVoted ? (
              <button onClick={() => onVote(postId, opt.id)} style={{
                width: "100%", padding: "8px 14px", textAlign: "left",
                background: "var(--surface)", border: "1.5px solid var(--border)",
                borderRadius: 20, cursor: "pointer", fontSize: 13, fontFamily: "inherit",
                color: "var(--text)", transition: "border-color 0.15s",
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#9a7858"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
              >{opt.label}</button>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: isMyVote ? "var(--text)" : "var(--text3)", fontWeight: isMyVote ? 600 : 400 }}>
                    {isMyVote ? "✓ " : ""}{opt.label}
                  </span>
                  <span style={{ color: "var(--text4)" }}>{count} ({pct}%)</span>
                </div>
                <div style={{ height: 4, background: "var(--border2)", borderRadius: 2 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: isMyVote ? "var(--info)" : "var(--border3)", borderRadius: 2, transition: "width 0.4s" }} />
                </div>
              </div>
            )}
          </div>
        );
      })}
      {hasVoted && <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 6 }}>{total} Stimme{total !== 1 ? "n" : ""} abgegeben</div>}
    </div>
  );
}

// ─── Post card ────────────────────────────────────────────────────────────────
function PostCard({ post, currentUser, canWrite, onEdit, onDelete, onPin, onVote }: {
  post: BlogPost; currentUser?: CurrentUser | null; canWrite: boolean;
  onEdit: (post: BlogPost) => void; onDelete: (id: string) => void; onPin: (id: string) => void; onVote: (postId: string, optionId: string) => void;
}) {
  const meta = TYPE_META[post.type] || TYPE_META.beitrag;
  const isOwn = post.authorId === currentUser?.id;
  const isAdmin = currentUser?.role === "admin";
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const bodyLines = (post.body || "").split("\n");
  const isLong = bodyLines.length > 6 || (post.body?.length || 0) > 400;
  const isDraft = post.status === "entwurf";

  return (
    <div style={{ background: "var(--surface)", border: isDraft ? "1.5px dashed var(--border3)" : "1px solid var(--border2)", borderRadius: 14, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.05)", overflow: "hidden", opacity: isDraft ? 0.85 : 1 }}>
      {post.image && (
        <img src={post.image} alt="" style={{ width: "100%", maxHeight: 300, objectFit: "cover", display: "block" }} />
      )}
      <div style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 10px", borderRadius: 20, color: meta.color, background: meta.bg, letterSpacing: "0.06em" }}>
              {meta.label.toUpperCase()}
            </span>
            {isDraft && <span style={{ fontSize: 10, color: "var(--pending)", background: "var(--pending-bg)", fontWeight: 600, padding: "2px 10px", borderRadius: 20, letterSpacing: "0.06em" }}>ENTWURF</span>}
            {post.pinned && <span style={{ fontSize: 10, color: "#b07848", fontWeight: 600, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 3 }}><span className="msr" style={{ fontSize: 12 }}>push_pin</span> ANGEPINNT</span>}
            {post.eventDate && (
              <span style={{ fontSize: 11, color: "var(--positive)", background: "var(--positive-bg)", padding: "2px 10px", borderRadius: 20 }}>
                📅 {new Date(post.eventDate).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "long" })}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 8 }}>
            {isAdmin && !isDraft && (
              <button onClick={() => onPin(post.id)} title={post.pinned ? "Loslösen" : "Anpinnen"}
                style={{ background: "none", border: "none", cursor: "pointer", opacity: post.pinned ? 1 : 0.4, padding: 2, display: "flex", alignItems: "center" }}><span className="msr" style={{ fontSize: 18 }}>push_pin</span></button>
            )}
            {(isOwn || isAdmin) && canWrite && (
              <>
                <button onClick={() => onEdit(post)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text4)", padding: "2px 6px", display: "flex", alignItems: "center" }}><span className="msr" style={{ fontSize: 16 }}>edit</span></button>
                {confirmDel ? (
                  <>
                    <span style={{ fontSize: 11, color: "var(--negative)", fontFamily: "inherit" }}>Löschen?</span>
                    <button onClick={() => onDelete(post.id)} style={{ background: "var(--negative)", color: "#fff", border: "none", borderRadius: 20, cursor: "pointer", fontSize: 11, padding: "2px 8px", fontFamily: "inherit" }}>Ja</button>
                    <button onClick={() => setConfirmDel(false)} style={{ background: "none", border: "1px solid var(--border3)", borderRadius: 20, cursor: "pointer", fontSize: 11, padding: "2px 8px", fontFamily: "inherit", color: "var(--text3)" }}>Nein</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDel(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--negative)", padding: "2px 6px", display: "flex", alignItems: "center" }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>
                )}
              </>
            )}
          </div>
        </div>

        {post.title && <div style={{ fontSize: 17, fontFamily: "'Inter', sans-serif", color: "var(--text)", marginBottom: 8, lineHeight: 1.3 }}>{post.title}</div>}

        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-wrap", overflow: "hidden", maxHeight: expanded ? "none" : "6.8em" }}>
          {post.body}
        </div>
        {isLong && (
          <button onClick={() => setExpanded(e => !e)} style={{ background: "none", border: "none", color: "#9a7858", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "4px 0", marginTop: 2 }}>
            {expanded ? "Weniger anzeigen ↑" : "Mehr anzeigen ↓"}
          </button>
        )}

        <PollBlock poll={post.poll} postId={post.id} currentUserId={currentUser?.id} onVote={onVote} />

        <div style={{ marginTop: 12, fontSize: 11, color: "var(--text4)", display: "flex", gap: 16 }}>
          <span>{post.authorName}</span>
          <span>{new Date(post.createdAt).toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Post modal ───────────────────────────────────────────────────────────────
function PostModal({ initial, onSave, onClose }: {
  initial: BlogPost | null; onSave: (form: PostForm, draft: boolean) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<PostForm>((initial as PostForm | null) || { title: "", body: "", type: "beitrag", eventDate: "", pinned: false, poll: null, image: "" });
  const [pollEnabled, setPollEnabled] = useState(!!initial?.poll);
  const [poll, setPoll] = useState<Poll>(initial?.poll || { question: "", options: [{ id: generateId(), label: "" }, { id: generateId(), label: "" }], votes: {} });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setF = (patch: Partial<PostForm>) => setForm(f => ({ ...f, ...patch }));
  const setOpt = (id: string, label: string) => setPoll(p => ({ ...p, options: p.options.map(o => o.id === id ? { ...o, label } : o) }));
  const addOpt = () => { if (poll.options.length >= 5) return; setPoll(p => ({ ...p, options: [...p.options, { id: generateId(), label: "" }] })); };
  const delOpt = (id: string) => { if (poll.options.length <= 2) return; setPoll(p => ({ ...p, options: p.options.filter(o => o.id !== id) })); };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setF({ image: await imageFileToJpeg(file, 1200, 0.8) });
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleSave = (draft = false) => {
    if (!form.body.trim()) return;
    const finalPoll = pollEnabled && poll.question.trim() && poll.options.filter(o => o.label.trim()).length >= 2
      ? { ...poll, options: poll.options.filter(o => o.label.trim()), votes: initial?.poll?.votes || {} }
      : null;
    onSave({ ...form, poll: finalPoll }, draft);
  };

  const isDraft = initial?.status === "entwurf";
  const isNew = !initial;
  const primaryLabel = (isNew || isDraft) ? "Veröffentlichen" : "Speichern";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, marginBottom: 20, color: "var(--text)" }}>
          {initial ? "Beitrag bearbeiten" : "Neuer Beitrag"}
        </div>

        <div className="form-row" style={{ marginBottom: 14 }}>
          <div className="form-group" style={{ flex: "0 0 160px" }}>
            <label>TYP</label>
            <select value={form.type} onChange={e => setF({ type: e.target.value })}>
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {form.type === "event" && (
            <div className="form-group">
              <label>DATUM</label>
              <input type="date" value={form.eventDate} onChange={e => setF({ eventDate: e.target.value })} />
            </div>
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>TITEL (optional)</label>
          <input value={form.title} onChange={e => setF({ title: e.target.value })} placeholder="Titel des Beitrags…" />
        </div>

        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>INHALT *</label>
          <textarea value={form.body} onChange={e => setF({ body: e.target.value })} rows={5} placeholder="Beitragstext…" style={{ minHeight: 120, resize: "vertical" }} />
        </div>

        {/* Image upload */}
        <div style={{ marginBottom: 14 }}>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImage} />
          {form.image ? (
            <div style={{ position: "relative" }}>
              <img src={form.image} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, display: "block" }} />
              <button onClick={() => setF({ image: "" })} style={{
                position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.55)", border: "none",
                borderRadius: 20, color: "#fff", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit",
              }}>Bild entfernen</button>
            </div>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} style={{
              width: "100%", padding: "10px 0", border: "1.5px dashed var(--border3)", borderRadius: 20,
              background: "transparent", color: "var(--text4)", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>+ Beitragsbild hochladen</button>
          )}
        </div>

        {/* Poll */}
        <div style={{ marginBottom: 18, padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border2)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, marginBottom: pollEnabled ? 12 : 0 }}>
            <input type="checkbox" checked={pollEnabled} onChange={e => setPollEnabled(e.target.checked)} style={{ width: "auto" }} />
            Umfrage hinzufügen
          </label>
          {pollEnabled && (
            <>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label>FRAGE</label>
                <input value={poll.question} onChange={e => setPoll(p => ({ ...p, question: e.target.value }))} placeholder="z.B. Bist du dabei?" />
              </div>
              <label style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--text4)", fontWeight: 500, display: "block", marginBottom: 6 }}>ANTWORTMÖGLICHKEITEN</label>
              {poll.options.map((opt, i) => (
                <div key={opt.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input value={opt.label} onChange={e => setOpt(opt.id, e.target.value)} placeholder={`Option ${i + 1}`} style={{ flex: 1 }} />
                  {poll.options.length > 2 && <button onClick={() => delOpt(opt.id)} style={{ background: "none", border: "none", color: "var(--negative)", cursor: "pointer", padding: "0 4px", display: "flex", alignItems: "center" }}><span className="msr" style={{ fontSize: 16 }}>close</span></button>}
                </div>
              ))}
              {poll.options.length < 5 && (
                <button onClick={addOpt} style={{ background: "none", border: "1px dashed var(--border3)", borderRadius: 20, padding: "5px 12px", fontSize: 11, color: "var(--text4)", cursor: "pointer", fontFamily: "inherit", marginTop: 2 }}>+ Option</button>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-ghost" onClick={() => handleSave(true)} disabled={!form.body.trim()}>
            Als Entwurf speichern
          </button>
          <button className="btn btn-primary" onClick={() => handleSave(false)} disabled={!form.body.trim()}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function Pinboard({ data, update, currentUser }: Pick<ViewProps, "data" | "update" | "currentUser">) {
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; post: BlogPost } | null>(null); // null | { mode: "create" } | { mode: "edit", post }
  const [filter, setFilter] = useState("alle");
  const canWrite = canWriteCheck(currentUser, data);
  const posts = data.blogPosts || [];
  const myId = currentUser?.id;
  const isAdminUser = currentUser?.role === "admin";

  const sorted = [...posts]
    .filter(p => {
      if (p.status === "entwurf" && p.authorId !== myId && !isAdminUser) return false;
      if (filter === "entwuerfe") return p.status === "entwurf";
      if (filter !== "alle") return p.type === filter;
      return true;
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const savePost = (form: PostForm, draft = false) => {
    const status = draft ? "entwurf" : "published";
    if (modal?.mode === "edit") {
      update("blogPosts", posts.map(p => p.id === form.id ? { ...p, ...form, status } as BlogPost : p));
    } else {
      const newPost: BlogPost = {
        ...form,
        id: generateId(),
        authorId: myId || "admin",
        authorName: currentUser?.displayName || currentUser?.username || "—",
        createdAt: new Date().toISOString(),
        pinned: false,
        status,
      };
      update("blogPosts", [newPost, ...posts]);
    }
    setModal(null);
  };

  const deletePost = (id: string) => update("blogPosts", posts.filter(p => p.id !== id));
  const togglePin  = (id: string) => update("blogPosts", posts.map(p => p.id === id ? { ...p, pinned: !p.pinned } : p));

  const vote = (postId: string, optionId: string) => {
    update("blogPosts", posts.map(p => {
      if (p.id !== postId || !p.poll) return p;
      const votes = { ...p.poll.votes, [currentUser?.id as string]: optionId };
      return { ...p, poll: { ...p.poll, votes } };
    }));
  };

  // Holiday notice this week
  const today = localISODate();
  const getMonday = (dateStr: string) => { const dd = new Date(`${dateStr}T00:00:00Z`); dd.setUTCDate(dd.getUTCDate() - (dd.getUTCDay() === 0 ? 6 : dd.getUTCDay() - 1)); return dd; };
  const weekStart = getMonday(today);
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  // repeatsYearly-Feiertage (alle Standard-Feiertage, Basisjahr 2000, siehe Settings.jsx)
  // über getFeiertageForYear auflösen — ein direkter Datumsvergleich fände sonst in
  // keinem anderen Jahr einen Treffer (gleicher Bug wie im Dashboard-Pinnwand-Widget).
  // Jahresgrenze der Woche (z.B. 29.12.–4.1.) berücksichtigen: ggf. zwei Jahre auflösen.
  const weekYears = new Set([weekStart.getUTCFullYear(), weekEnd.getUTCFullYear()]);
  const feiertageThisWeek = [...weekYears].flatMap(y => getFeiertageForYear(data.feiertage || [], y))
    .filter(f => f.date >= toISO(weekStart) && f.date <= toISO(weekEnd));

  const FILTER_OPTS = [
    { id: "alle", label: "Alle" },
    { id: "beitrag", label: "Beiträge" },
    { id: "ankuendigung", label: "Ankündigungen" },
    { id: "event", label: "Events" },
    ...(canWrite ? [{ id: "entwuerfe", label: "Entwürfe" }] : []),
  ];

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: 20, border: "1.5px solid", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
    background: active ? "var(--text)" : "var(--surface)",
    color: active ? "var(--bg)" : "var(--text3)",
    borderColor: active ? "var(--text)" : "var(--border3)",
    transition: "all 0.15s",
  });

  const leftPosts  = sorted.filter((_, i) => i % 2 === 0);
  const rightPosts = sorted.filter((_, i) => i % 2 === 1);

  const renderCard = (post: BlogPost) => (
    <PostCard
      key={post.id}
      post={post}
      currentUser={currentUser}
      canWrite={canWrite}
      onEdit={p => setModal({ mode: "edit", post: p })}
      onDelete={deletePost}
      onPin={togglePin}
      onVote={vote}
    />
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: "'Inter', sans-serif", fontSize: 30, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1, color: "var(--text)", marginBottom: 6 }}>Pinnwand</h1>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTER_OPTS.map(opt => (
              <button key={opt.id} onClick={() => setFilter(opt.id)} style={btnStyle(filter === opt.id)}>{opt.label}</button>
            ))}
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })} style={{ flexShrink: 0 }}>
            + Beitrag
          </button>
        )}
      </div>

      {/* Holiday notice */}
      {feiertageThisWeek.length > 0 && (
        <div style={{ padding: "12px 18px", background: "var(--positive-bg)", border: "1.5px solid #a8d8b8", borderRadius: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>🎉</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--positive)", marginBottom: 2 }}>Feiertag diese Woche</div>
            <div style={{ fontSize: 12, color: "#3a7a5a" }}>
              {feiertageThisWeek.map(f => `${new Date(f.date).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" })}: ${f.label}`).join(" · ")}
            </div>
          </div>
        </div>
      )}

      {sorted.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text4)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14 }}>Noch keine Beiträge</div>
          {canWrite && <div style={{ fontSize: 12, marginTop: 6 }}>Erstelle den ersten Beitrag mit dem Button oben rechts.</div>}
        </div>
      )}

      {sorted.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          <div>{leftPosts.map(renderCard)}</div>
          <div>{rightPosts.map(renderCard)}</div>
        </div>
      )}

      {modal && (
        <PostModal
          initial={modal.mode === "edit" ? modal.post : null}
          onSave={savePost}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
