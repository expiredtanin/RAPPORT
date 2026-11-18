// Zoomstufen des Zeitstrahls (GanttChart): Breite eines Tages in Pixeln.

/** Zoomstufen: Tage, Wochen, Monate. */
export const ZOOM_LEVELS: { id: string; label: string; dayWidth: number }[] = [
  { id: "tag", label: "Tage", dayWidth: 22 },
  { id: "woche", label: "Wochen", dayWidth: 8 },
  { id: "monat", label: "Monate", dayWidth: 2.6 },
];
