import { useEffect, useState } from "react";

const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);

export function useRoute(): string[] {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const navigate = (path: string) => {
  window.location.hash = `/${path.replace(/^\//, "")}`;
};
