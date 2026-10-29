/// <reference path="../pb_data/types.d.ts" />
// Setzt die native PB-Einstellung meta.accentColor auf RAPPORTs Akzentfarbe (#b07848).
// Ergänzt das CSS-Overlay in RAPPORT-SERVER/nginx.conf: der Grossteil des Admin-UI-Looks
// (Flächen/Text/Radius) lässt sich per CSS-Custom-Property-Override erreichen, aber die
// Akzentfarbe setzt PB nach dem Login per JS als INLINE Style auf <html> (aus genau diesem
// Settings-Feld) — ein externes Stylesheet kann eine Inline-Style-Deklaration nicht per
// Cascade-Reihenfolge schlagen, nur echtes !important, was fragil wäre. Über die eigene
// Einstellung zu gehen ist der von PB vorgesehene Weg (siehe MetaConfig.accentColor in
// pb_data/types.d.ts, "specify the UI accent color").

migrate((app) => {
  const settings = app.settings();
  settings.meta.accentColor = "#b07848";
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.meta.accentColor = "#1055c9";
  app.save(settings);
});
