// Zeiterfassung: Saldo-Karte des gewählten Mitarbeiters — eine Tabelle Ist/Soll/Saldo für Monat und
// «seit Eintritt» (nach Abzug ausbezahlter Überstunden, mit Hinweis bei unplausibel grossem Minus) und darunter
// der Ferienrest in Tagen.

import { formatDays } from "../../utils";
import type { Employee } from "../../types";
import type { calcTotalSaldo, calcMonthSaldo, calcFerienSaldo } from "./timeUtils";

/** Props der Saldo-Karte; die Salden berechnet Time.tsx mit den Funktionen aus timeUtils. */
interface SaldoCardsProps {
  selectedEmp: Employee | null;
  currentDate: string;
  totalSaldo: ReturnType<typeof calcTotalSaldo>;
  monthSaldo: ReturnType<typeof calcMonthSaldo>;
  ferienSaldo: ReturnType<typeof calcFerienSaldo>;
}

/** «7.5 h» / «−70.3 h» / «10’283 h» mit typografischem Minus; `sign` setzt «+» vor positive Werte, `unit` = false lässt «h» weg. */
const fh = (h: number, sign = false, unit = true) => {
  // Ab 1000 h ohne Dezimale, damit die drei Spalten in die schmale Karte passen
  const r = Math.abs(h) >= 1000 ? Math.round(h) : Math.round(h * 10) / 10;
  const s = (Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1)).replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  return `${r < 0 ? "−" : sign && r > 0 ? "+" : ""}${s}${unit ? " h" : ""}`;
};

/** Farbklasse eines Saldos: erst ab einer halben Stunde Abweichung farbig. */
const saldoCls = (v: number) => v <= -0.5 ? " neg" : v >= 0.5 ? " pos" : "";

/** Eine Karte: Monat und seit Eintritt (Ist/Soll/Saldo), darunter Ferien des Jahres in Tagen. */
export function SaldoCards({ selectedEmp, currentDate, totalSaldo, monthSaldo, ferienSaldo }: SaldoCardsProps) {
  if (!selectedEmp) return null;
  // Riesiges Minus bei kaum erfassten Stunden deutet eher auf fehlende ältere Einträge als auf echte Minusstunden
  const suspectSaldo = !!totalSaldo && Math.abs(totalSaldo.saldo) > 500 && totalSaldo.ist < totalSaldo.soll * 0.3;
  const monthName = new Date(currentDate + "T12:00:00").toLocaleString("de-CH", { month: "long" });
  const year = currentDate.slice(0, 4);
  const ferienTotal = ferienSaldo ? ferienSaldo.anspruch + ferienSaldo.ubertrag : 0;
  const ferienUsed = ferienSaldo ? ferienSaldo.bezogen + ferienSaldo.geplant : 0;
  const days = (h: number) => formatDays(h, selectedEmp);

  return (
    <div className="card">
      <div className="zeit-k">Saldo <span>in Stunden · Pensum {selectedEmp.pensum || 100} %</span></div>
      <div className="zeit-saldo">
        <span className="h l" />
        <span className="h">Ist</span>
        <span className="h">Soll</span>
        <span className="h">Saldo</span>
        {monthSaldo && (
          <>
            <span className="l" style={{ textTransform: "capitalize" }}>{monthName}</span>
            <span className="num" title={monthSaldo.absenz > 0 ? `inkl. ${fh(monthSaldo.absenz)} Absenzen` : undefined}>{fh(monthSaldo.ist + monthSaldo.absenz, false, false)}</span>
            <span className="num" title={`Soll bis heute; ganzer Monat ${fh(monthSaldo.sollTotal)}`}>{fh(monthSaldo.soll, false, false)}</span>
            <span className={`num s${saldoCls(monthSaldo.saldo)}`}>{fh(monthSaldo.saldo, true, false)}</span>
          </>
        )}
        {totalSaldo && (
          <>
            <span className="l" title={selectedEmp.eintrittsdatum ? `seit ${new Date(selectedEmp.eintrittsdatum + "T12:00:00").toLocaleDateString("de-CH")}` : undefined}>Seit Eintritt</span>
            <span className="num" title={totalSaldo.absenz > 0 ? `inkl. ${fh(totalSaldo.absenz)} Absenzen` : undefined}>{fh(totalSaldo.ist + totalSaldo.absenz, false, false)}</span>
            <span className="num">{fh(totalSaldo.soll, false, false)}</span>
            <span className={`num s${suspectSaldo ? "" : saldoCls(totalSaldo.saldo)}`} title={totalSaldo.paidOut ? `nach Abzug von ${fh(totalSaldo.paidOut)} ausbezahlten Überstunden` : undefined}>{fh(totalSaldo.saldo, true, false)}</span>
          </>
        )}
      </div>
      {suspectSaldo && (
        <div className="zeit-hint">Sehr grosser Minussaldo — fehlen ältere Einträge? Eintrittsdatum unter Mitarbeiter → Personen prüfen.</div>
      )}

      {ferienSaldo && (
        <div className="zeit-ferien">
          <div className="zeit-ferien-row">
            <span>Ferien {year}</span>
            <span style={{ color: "var(--text4)", fontWeight: 400 }}>Rest <b className={`num${ferienSaldo.rest < 0 ? " neg" : ""}`} title={fh(ferienSaldo.rest)}>{days(ferienSaldo.rest)}</b></span>
          </div>
          <span className="zeit-bar"><i style={{ width: `${ferienTotal > 0 ? Math.min(100, (ferienUsed / ferienTotal) * 100) : 0}%` }} /></span>
          <div className="zeit-ferien-sub num">
            {days(ferienSaldo.anspruch)} Anspruch
            {ferienSaldo.ubertrag > 0 && ` · ${days(ferienSaldo.ubertrag)} Übertrag`}
            {ferienSaldo.bezogen > 0 && ` · ${days(ferienSaldo.bezogen)} bezogen`}
            {ferienSaldo.geplant > 0 && ` · ${days(ferienSaldo.geplant)} geplant`}
            {ferienSaldo.beantragt > 0 && ` · ${days(ferienSaldo.beantragt)} beantragt`}
          </div>
        </div>
      )}
    </div>
  );
}
