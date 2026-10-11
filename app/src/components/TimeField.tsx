// Seletor de hora sempre em 24h (o <input type="time"> segue o formato do
// aparelho e pode mostrar AM/PM). Com `noneLabel`, aceita "sem horário".
import { pad } from "@shared/scheduler/index.ts";

const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5));

export function TimeField({
  value,
  onChange,
  noneLabel,
  fallback = "08:00",
  label,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  /** Se informado, a hora ganha a opção "sem horário" (valor null). */
  noneLabel?: string;
  /** Hora usada ao sair de "sem horário". */
  fallback?: string;
  label: string;
}) {
  const [h, m] = (value ?? fallback).split(":");
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort();
  return (
    <div className="timefield" role="group" aria-label={label}>
      <select
        className={value === null ? "none" : ""}
        aria-label={`${label}: hora`}
        value={value === null ? "none" : h}
        onChange={(e) => onChange(e.target.value === "none" ? null : `${e.target.value}:${value === null ? fallback.split(":")[1] : m}`)}
      >
        {noneLabel && <option value="none">{noneLabel}</option>}
        {HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      {value !== null && (
        <>
          <span aria-hidden>:</span>
          <select aria-label={`${label}: minutos`} value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
            {minutes.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

/** Data (input nativo) + hora 24h. Valor em "YYYY-MM-DDTHH:MM" local. */
export function DateTimeField({ value, onChange, label, clearable }: { value: string; onChange: (v: string) => void; label: string; clearable?: boolean }) {
  const [d, t] = value ? value.split("T") : ["", ""];
  return (
    <div className="row" style={{ gap: 6 }}>
      <input type="date" aria-label={`${label}: dia`} value={d} style={{ flex: 1, minWidth: 0 }}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T${t || "12:00"}` : "")} />
      {d && <TimeField label={label} value={t || "12:00"} onChange={(v) => onChange(`${d}T${v}`)} />}
      {clearable && d && <button type="button" className="chip" onClick={() => onChange("")}>limpar</button>}
    </div>
  );
}
