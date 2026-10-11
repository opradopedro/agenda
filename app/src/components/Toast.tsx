import { useEffect, useState } from "react";

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();
export const toast = (msg: string) => listeners.forEach((l) => l(msg));

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const l: Listener = (m) => {
      setMsg(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3500);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(timer);
    };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
