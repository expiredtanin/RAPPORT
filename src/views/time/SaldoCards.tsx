// Zeiterfassung: Saldo-Karte (seit Eintritt, Monat, Ferien) des gewählten Mitarbeiters.

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

/** Drei Blöcke: Saldo seit Eintritt, Monatssaldo, Ferien des laufenden Jahres. */
export function SaldoCards({ selectedEmp, currentDate, totalSaldo, monthSaldo, ferienSaldo }: SaldoCardsProps) {
  return (
    <>
      {selectedEmp && (
        <div className="card" style={{ marginTop: 12, padding: "14px 16px" }}>
          <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid var(--border2)" }}>
            <div className="section-label" style={{ marginBottom: 4 }}>Saldo seit Eintritt</div>
            {totalSaldo && [
              { label: "Soll bis heute", value: `${totalSaldo.soll}h` },
              { label: "IST", value: `${totalSaldo.ist}h` },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", fontSize: 11, color: "var(--text3)" }}>
                <span>{r.label}</span><span>{r.value}</span>
              </div>
            ))}
            {totalSaldo && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)", fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                <span>Saldo</span>
                <strong style={{ color: totalSaldo.saldo >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {totalSaldo.saldo === 0 ? "0h" : `${totalSaldo.saldo > 0 ? "+" : ""}${totalSaldo.saldo}h`}
                </strong>
              </div>
            )}
          </div>
          <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid var(--border2)" }}>
            <div className="section-label" style={{ marginBottom: 4 }}>Monatssaldo — {new Date(currentDate + "T12:00:00").toLocaleString("de-CH", { month: "long" })}</div>
            {monthSaldo && [
              { label: "Soll", value: `${monthSaldo.soll}h` },
              { label: "IST", value: `${monthSaldo.ist}h` },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", fontSize: 11, color: "var(--text3)" }}>
                <span>{r.label}</span><span>{r.value}</span>
              </div>
            ))}
            {monthSaldo && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)", fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                <span>Saldo</span>
                <strong style={{ color: monthSaldo.saldo >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {monthSaldo.saldo === 0 ? "0h" : `${monthSaldo.saldo > 0 ? "+" : ""}${monthSaldo.saldo}h`}
                </strong>
              </div>
            )}
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>Ferien {new Date().getFullYear()}</div>
            {ferienSaldo && [
              { label: "Anspruch", value: `${ferienSaldo.anspruch}h`, show: true },
              { label: "Übertrag", value: `${ferienSaldo.ubertrag}h`, show: ferienSaldo.ubertrag > 0 },
              { label: "Bezogen", value: `${ferienSaldo.bezogen}h`, show: ferienSaldo.bezogen > 0 },
              { label: "Geplant", value: `${ferienSaldo.geplant}h`, show: ferienSaldo.geplant > 0 },
            ].filter(r => r.show).map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", fontSize: 11, color: "var(--text3)" }}>
                <span>{r.label}</span><span>{r.value}</span>
              </div>
            ))}
            {ferienSaldo && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)", fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                <span>Rest</span>
                <strong style={{ color: ferienSaldo.rest >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {ferienSaldo.rest === 0 ? "0h" : `${ferienSaldo.rest > 0 ? "+" : ""}${ferienSaldo.rest}h`}
                </strong>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
