import { useEffect, useRef, useState } from "react";
import { submitCapture } from "../data/capture";
import { describeRrule } from "@shared/scheduler/index.ts";
import { navigate } from "../lib/router";
import { useSpeech } from "../lib/speech";
import { IconMic, IconSend, IconStop } from "./Icons";
import { toast } from "./Toast";

export function CaptureBar() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viaVoice = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const speech = useSpeech((spoken) => {
    viaVoice.current = true;
    setText((t) => (t ? `${t} ${spoken}` : spoken));
  });

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text, speech.interim]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await submitCapture(t, viaVoice.current ? "voz" : "texto");
      setText("");
      viaVoice.current = false;
      if (r.questions.length) toast(`A IA ficou com dúvida: ${r.questions[0]}`);
      else if (r.routines.length) toast(`Rotina criada: ${r.routines.map((x) => `${x.title} (${describeRrule(x.rrule)})`).join("; ")}.`);
      if (!r.outcome) toast("Nada para agendar nesse texto.");
      else if (r.outcome.mode === "proposta") navigate(`proposta/${r.outcome.planId}`);
      else toast(`${r.outcome.placed} tarefa(s) agendada(s)${r.outcome.unplaced ? `, ${r.outcome.unplaced} sem horário (veja a Caixa)` : ""}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shown = speech.listening ? speech.interim || text : text;
  return (
    <div className="capture">
      {(busy || error || speech.error || speech.listening) && (
        <div className={`status ${error || speech.error ? "err" : ""}`}>
          {busy ? "Entendendo e organizando…" : speech.listening ? "Ouvindo… toque no quadrado para parar" : error ?? speech.error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={area}
          rows={1}
          placeholder="O que você precisa fazer?"
          value={shown}
          readOnly={speech.listening}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Capturar tarefas"
        />
        {speech.supported && (
          <button
            type="button"
            className={`round ${speech.listening ? "rec" : ""}`}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            aria-label={speech.listening ? "Parar de ouvir" : "Falar"}
            disabled={busy}
          >
            {speech.listening ? <IconStop /> : <IconMic />}
          </button>
        )}
        <button type="submit" className="round send" aria-label="Enviar" disabled={busy || !text.trim() || speech.listening}>
          <IconSend />
        </button>
      </form>
    </div>
  );
}
