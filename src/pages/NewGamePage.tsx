import { useMemo, useState, type FormEvent } from "react";
import { ARMY_OPTIONS } from "../data/armies";
import { RememberedNameField } from "../components/RememberedNameField";
import type { CreateGameInput } from "../types/game";
import { Layout } from "../components/Layout";
import { useGameStore } from "../store/GameStore";
import { loadRememberedPlayerNames } from "../utils/presets";
import { toLocalDateInput, toLocalTimeInput } from "../utils/time";

interface NewGamePageProps {
  onCreated: (gameId: string) => void;
  onBack: () => void;
}

const defaultFormState: CreateGameInput = {
  playerOneName: "",
  playerOneArmy: "",
  playerTwoName: "",
  playerTwoArmy: "",
  gamePoints: 2000,
  scheduledDate: toLocalDateInput(),
  scheduledTime: toLocalTimeInput(),
  deployment: "",
  primaryMission: "",
  defenderSlot: "player1",
  startingSlot: "player1"
};

export const NewGamePage = ({ onCreated, onBack }: NewGamePageProps) => {
  const { createGame, games, isMutating, errorMessage, clearError } = useGameStore();
  const [formState, setFormState] = useState<CreateGameInput>(defaultFormState);
  const playerOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...loadRememberedPlayerNames(),
          ...games.flatMap((game) => game.players.map((player) => player.name))
        ])
      ).sort((left, right) => left.localeCompare(right)),
    [games]
  );

  function updateField<K extends keyof CreateGameInput>(key: K, value: CreateGameInput[K]) {
    setFormState((current) => ({
      ...current,
      [key]: value
    }));
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const game = await createGame(formState);
      onCreated(game.id);
    } catch {
      return;
    }
  };

  return (
    <Layout
      title="Neues Spiel"
      subtitle="Spieler waehlen, Armeen auswaehlen, Punkte einmal setzen"
      onBack={onBack}
    >
      <form className="stack" onSubmit={handleSubmit}>
        {errorMessage ? (
          <article className="notice-card notice-card--error">
            <div className="stack">
              <div>
                <h2>Speichern fehlgeschlagen</h2>
                <p>{errorMessage}</p>
              </div>
              <button type="button" className="ghost-button" onClick={clearError}>
                Meldung ausblenden
              </button>
            </div>
          </article>
        ) : null}

        <section className="card stack">
          <h2>Spieler 1</h2>
          <RememberedNameField
            label="Name"
            value={formState.playerOneName}
            options={playerOptions}
            disabled={isMutating}
            onChange={(value) => updateField("playerOneName", value)}
          />
          <label className="field">
            <span>Armee</span>
            <select
              required
              value={formState.playerOneArmy}
              onChange={(event) => updateField("playerOneArmy", event.target.value)}
              disabled={isMutating}
            >
              <option value="">Armee waehlen</option>
              {ARMY_OPTIONS.map((army) => (
                <option key={army} value={army}>
                  {army}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="card stack">
          <h2>Spieler 2</h2>
          <RememberedNameField
            label="Name"
            value={formState.playerTwoName}
            options={playerOptions}
            disabled={isMutating}
            onChange={(value) => updateField("playerTwoName", value)}
          />
          <label className="field">
            <span>Armee</span>
            <select
              required
              value={formState.playerTwoArmy}
              onChange={(event) => updateField("playerTwoArmy", event.target.value)}
              disabled={isMutating}
            >
              <option value="">Armee waehlen</option>
              {ARMY_OPTIONS.map((army) => (
                <option key={army} value={army}>
                  {army}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="card stack">
          <h2>Spiel</h2>
          <label className="field">
            <span>Spielpunkte</span>
            <input
              required
              type="number"
              min={0}
              inputMode="numeric"
              value={formState.gamePoints}
              onChange={(event) => updateField("gamePoints", Number(event.target.value))}
              disabled={isMutating}
            />
          </label>
          <div className="two-column-grid">
            <label className="field">
              <span>Datum</span>
              <input
                required
                type="date"
                value={formState.scheduledDate}
                onChange={(event) => updateField("scheduledDate", event.target.value)}
                disabled={isMutating}
              />
            </label>
            <label className="field">
              <span>Uhrzeit</span>
              <input
                required
                type="time"
                value={formState.scheduledTime}
                onChange={(event) => updateField("scheduledTime", event.target.value)}
                disabled={isMutating}
              />
            </label>
          </div>
          <label className="field">
            <span>Aufstellung</span>
            <input
              value={formState.deployment}
              onChange={(event) => updateField("deployment", event.target.value)}
              disabled={isMutating}
            />
          </label>
          <label className="field">
            <span>Primaermission</span>
            <input
              value={formState.primaryMission}
              onChange={(event) => updateField("primaryMission", event.target.value)}
              disabled={isMutating}
            />
          </label>

          <div className="field">
            <span>Defender</span>
            <div className="segmented-control">
              <button
                type="button"
                className={formState.defenderSlot === "player1" ? "is-selected" : ""}
                onClick={() => updateField("defenderSlot", "player1")}
                disabled={isMutating}
              >
                Spieler 1
              </button>
              <button
                type="button"
                className={formState.defenderSlot === "player2" ? "is-selected" : ""}
                onClick={() => updateField("defenderSlot", "player2")}
                disabled={isMutating}
              >
                Spieler 2
              </button>
            </div>
          </div>

          <div className="field">
            <span>Startspieler</span>
            <div className="segmented-control">
              <button
                type="button"
                className={formState.startingSlot === "player1" ? "is-selected" : ""}
                onClick={() => updateField("startingSlot", "player1")}
                disabled={isMutating}
              >
                Spieler 1
              </button>
              <button
                type="button"
                className={formState.startingSlot === "player2" ? "is-selected" : ""}
                onClick={() => updateField("startingSlot", "player2")}
                disabled={isMutating}
              >
                Spieler 2
              </button>
            </div>
          </div>
        </section>

        <button type="submit" className="primary-button primary-button--large" disabled={isMutating}>
          {isMutating ? "Speichere..." : "Spiel anlegen"}
        </button>
      </form>
    </Layout>
  );
};
