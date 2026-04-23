import { useEffect, useState } from "react";
import type { Player } from "../types/game";

export type ActionKind = "cp-gained" | "cp-spent" | "primary" | "secondary" | "note";

interface ActionPanelProps {
  players: [Player, Player];
  action: ActionKind | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onSubmit: (payload: { playerId: string; value?: number; note?: string }) => Promise<void> | void;
}

const ACTION_LABELS: Record<ActionKind, string> = {
  "cp-gained": "CP erhalten",
  "cp-spent": "CP ausgeben",
  primary: "Primary",
  secondary: "Secondary",
  note: "Notiz"
};

export const ActionPanel = ({
  players,
  action,
  isSubmitting = false,
  onCancel,
  onSubmit
}: ActionPanelProps) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState(players[0].id);
  const [value, setValue] = useState(1);
  const [note, setNote] = useState("");

  useEffect(() => {
    setSelectedPlayerId(players[0].id);
    setValue(1);
    setNote("");
  }, [action, players]);

  if (!action) {
    return null;
  }

  const isNoteOnly = action === "note";

  return (
    <section className="action-panel">
      <div className="action-panel__head">
        <h3>{ACTION_LABELS[action]}</h3>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Schliessen
        </button>
      </div>

      <div className="segmented-control">
        {players.map((player) => (
          <button
            key={player.id}
            type="button"
            className={selectedPlayerId === player.id ? "is-selected" : ""}
            onClick={() => setSelectedPlayerId(player.id)}
            disabled={isSubmitting}
          >
            {player.name}
          </button>
        ))}
      </div>

      {!isNoteOnly ? (
        <label className="field">
          <span>Wert</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(Number(event.target.value))}
            disabled={isSubmitting}
          />
        </label>
      ) : null}

      <label className="field">
        <span>Notiz</span>
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional"
          disabled={isSubmitting}
        />
      </label>

      <button
        type="button"
        className="primary-button"
        disabled={isSubmitting}
        onClick={async () => {
          await onSubmit({
            playerId: selectedPlayerId,
            value: isNoteOnly ? undefined : value,
            note
          });
          setValue(1);
          setNote("");
        }}
      >
        Speichern
      </button>
    </section>
  );
};
