import { useEffect, useState } from "react";
import { terrainMatchQuery } from "../utils/matchHud";

interface OnlineMatchPanelProps {
  matchId: string;
  pending?: boolean;
}

export const OnlineMatchPanel = ({ matchId, pending = false }: OnlineMatchPanelProps) => {
  const query = terrainMatchQuery(matchId);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const copy = async (text: string, success: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setNotice(success);
        return;
      }
    } catch {
      // Text bleibt sichtbar, falls die Zwischenablage blockiert.
    }
    setNotice(text);
  };

  return (
    <section className="card stack match-online">
      <div className="list-row">
        <h2>Online</h2>
        <span className="meta-chip">match_id</span>
      </div>
      <p className="match-online__id">{matchId}</p>
      <div className="button-row button-row--compact">
        <button type="button" className="ghost-button compact-button" onClick={() => void copy(matchId, "ID kopiert")}>
          ID kopieren
        </button>
        <button type="button" className="ghost-button compact-button" onClick={() => void copy(query, "Query kopiert")}>
          Query kopieren
        </button>
      </div>
      <p className="muted-copy">
        Gelände-Layout: Query <span className="match-online__id">{query}</span> an die Gelände-URL hängen.
        Der Host wird hier nicht festgelegt.
      </p>
      {pending ? <p className="muted-copy">Gilt nach dem Speichern.</p> : null}
      {notice ? <p className="muted-copy">{notice}</p> : null}
    </section>
  );
};
