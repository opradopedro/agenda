// Microfone: Web Speech API (Chrome/Edge). No Android empacotado (Fase 3)
// troca por plugin nativo.
import { useCallback, useEffect, useRef, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Recognition = any;

function ctor(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export function useSpeech(onFinal: (text: string) => void) {
  const supported = typeof window !== "undefined" && ctor() !== null;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition>(null);
  const finalCb = useRef(onFinal);
  finalCb.current = onFinal;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return;
    const r = new C();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = true;
    let finalText = "";
    r.onresult = (ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      let live = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript + " ";
        else live += res[0].transcript;
      }
      setInterim((finalText + live).trim());
    };
    r.onerror = (ev: { error: string }) => {
      setError(ev.error === "not-allowed" ? "Permita o uso do microfone no navegador." : `Microfone: ${ev.error}`);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
      if (finalText.trim()) finalCb.current(finalText.trim());
    };
    setError(null);
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => rec.current?.abort?.(), []);
  return { supported, listening, interim, error, start, stop };
}
