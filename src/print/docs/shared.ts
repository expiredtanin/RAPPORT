// Gemeinsames der Druckvorlagen in print/docs/: Typen für Inhalt und Empfänger, Titelstil.
// Konventionen der Vorlagen (Farben/Schriften nur über CSS-Variablen) stehen im Kopf von print/PrintComponents.tsx.

import React from "react";
import type { Person, PrintContent } from "../../types";

export type Content = NonNullable<PrintContent>;

export type Client = Person | undefined | null;

/** Titelschrift und Akzentfarbe (siehe docDesign.ts); Elemente damit tragen zusätzlich die Klasse `doc-heading`. */
export const HEADING: React.CSSProperties = { fontFamily: "var(--doc-font-heading)", color: "var(--doc-accent)" };
