/// <reference path="../pb_data/types.d.ts" />
// Optimistische Sperre beim Speichern (Entscheid 26.11.2026: «alles nach klaren Regeln»).
// Regel: Ein Update, das auf einem veralteten Stand beruht, darf einen inzwischen geänderten Datensatz nicht still
// überschreiben. Die App schickt bei jedem Update den `updated`-Zeitstempel des Stands mit, auf dem ihre Änderung
// beruht (Header X-Rapport-If-Updated, gelesen als «x_rapport_if_updated»; auch in Batch-Anfragen je Eintrag). Ist der
// Datensatz auf dem Server inzwischen neuer, antwortet der Server mit 409; die App lädt ihn dann frisch, verrechnet
// ihre Änderung drei Wege und versucht erneut (src/storage/pocketbase-conflict.ts). Vorher ging z.B. bei zwei
// Änderungen an einer Rechnung innerhalb ~1 s die erste still verloren (Positionen/Total des zweiten Schreibers).
// Ohne Header (ältere App, Admin-Dashboard, Skripte) gilt das Update wie bisher; Datensätze ohne `updated` (leer)
// werden nicht geprüft. Für alle Collections (der Header kommt nur von der App, nur für ihre Daten-Collections).
// Restfenster: Prüfung und Schreiben sind nicht eine Transaktion — zwei Updates in denselben Millisekunden können
// beide durchgehen (vorher: das ganze Speicher-Intervall von bis zu ~1 s).

onRecordUpdateRequest((e) => {
  const want = String((e.requestInfo().headers || {})["x_rapport_if_updated"] || "").trim();
  if (want) {
    const cur = e.record.original().getString("updated");
    if (cur && cur !== want) {
      throw new ApiError(409, "Dieser Datensatz wurde inzwischen von jemand anderem geändert.", {});
    }
  }
  e.next();
});
