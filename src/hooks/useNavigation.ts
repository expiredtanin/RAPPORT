// Navigation als String-State-Machine mit Vor/Zurück-Verlauf. Es gibt keinen Router:
// `view` ist die ID aus NAV_ITEMS (oder eine Unteransicht), `navigate` hängt an den Verlauf an
// und verwirft dabei den «Vorwärts»-Ast, wie ein Browser. Die URL ändert sich nicht.

import { useCallback, useRef, useState } from "react";

/** @param initialView Startansicht (vom Aufrufer nach Rechten gewählt). */
export function useNavigation(initialView: string) {
  const [view, setView] = useState(initialView);
  const navHistRef = useRef([view]);
  const navPosRef  = useRef(0);
  const [navCanBack,    setNavCanBack]    = useState(false);
  const [navCanForward, setNavCanForward] = useState(false);

  // Stabile Referenzen (nur Refs und Setter), damit Effekte in App.tsx sie als Abhängigkeit führen können.
  const navigate = useCallback((newView: string) => {
    const pos = navPosRef.current;
    const hist = navHistRef.current;
    if (hist[pos] === newView) return;
    const trimmed = [...hist.slice(0, pos + 1), newView];
    navHistRef.current = trimmed;
    navPosRef.current  = trimmed.length - 1;
    setView(newView);
    setNavCanBack(true);
    setNavCanForward(false);
  }, []);
  const goBack = useCallback(() => {
    const pos = navPosRef.current;
    if (pos <= 0) return;
    navPosRef.current = pos - 1;
    setView(navHistRef.current[pos - 1]);
    setNavCanBack(pos - 1 > 0);
    setNavCanForward(true);
  }, []);
  const goForward = useCallback(() => {
    const pos = navPosRef.current;
    const hist = navHistRef.current;
    if (pos >= hist.length - 1) return;
    navPosRef.current = pos + 1;
    setView(hist[pos + 1]);
    setNavCanBack(true);
    setNavCanForward(pos + 1 < hist.length - 1);
  }, []);

  return { view, navigate, goBack, goForward, navCanBack, navCanForward };
}
