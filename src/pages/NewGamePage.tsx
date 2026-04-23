import { useState, type FormEvent } from "react";
import type { CreateGameInput } from "../types/game";
import { Layout } from "../components/Layout";
import { useGameStore } from "../store/GameStore";
import { toLocalDateInput, toLocalTimeInput } from "../utils/time";

interface NewGamePageProps {
  onCreated: (gameId: string) => void;
}

const defaultFormState: CreateGameInput = {
  playerOneName: "",
  playerOneArmy: "",
  playerOneMaxPoints: 2000,
  playerTwoName: "",
  playerTwoArmy: "",
  playerTwoMaxPoints: 2000,
  scheduledDate: toLocalDateInput(),
  scheduledTime: toLocalTimeInput(),
  defenderSlot: "player1",
  startingSlot: "player1"
};

export const NewGamePage = ({ onCreated }: NewGamePageProps) => {
  const { createGame } = useGameStore();
  const [formState, setFormState] = useState<CreateGameInput>(defaultFormState);

  function updateField<K extends keyof CreateGameInput>(key: K, value: CreateGameInput[K]) {
    setFormState((current) => ({
      ...current,
      [key]: value
    }));
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const game = createGame(formState);
    onCreated(game.id);
  };

  return (
    <Layout title="Neues Spiel" subtitle="Metadaten und beide Armeen direkt anlegen">
      <form className="stack" onSubmit={handleSubmit}>
        <section className="card stack">
          <h2>Spieler 1</h2>
          <label className="field">
            <span>Name</span>
            <input
              required
              value={formState.playerOneName}
              onChange={(event) => updateField("playerOneName", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Armee</span>
            <input
              required
              value={formState.playerOneArmy}
              onChange={(event) => updateField("playerOneArmy", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Max Punkte</span>
            <input
              required
              type="number"
              min={0}
              inputMode="numeric"
              value={formState.playerOneMaxPoints}
              onChange={(event) => updateField("playerOneMaxPoints", Number(event.target.value))}
            />
          </label>
        </section>

        <section className="card stack">
          <h2>Spieler 2</h2>
          <label className="field">
            <span>Name</span>
            <input
              required
              value={formState.playerTwoName}
              onChange={(event) => updateField("playerTwoName", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Armee</span>
            <input
              required
              value={formState.playerTwoArmy}
              onChange={(event) => updateField("playerTwoArmy", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Max Punkte</span>
            <input
              required
              type="number"
              min={0}
              inputMode="numeric"
              value={formState.playerTwoMaxPoints}
              onChange={(event) => updateField("playerTwoMaxPoints", Number(event.target.value))}
            />
          </label>
        </section>

        <section className="card stack">
          <h2>Spiel</h2>
          <div className="two-column-grid">
            <label className="field">
              <span>Datum</span>
              <input
                required
                type="date"
                value={formState.scheduledDate}
                onChange={(event) => updateField("scheduledDate", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Uhrzeit</span>
              <input
                required
                type="time"
                value={formState.scheduledTime}
                onChange={(event) => updateField("scheduledTime", event.target.value)}
              />
            </label>
          </div>

          <div className="field">
            <span>Defender</span>
            <div className="segmented-control">
              <button
                type="button"
                className={formState.defenderSlot === "player1" ? "is-selected" : ""}
                onClick={() => updateField("defenderSlot", "player1")}
              >
                Spieler 1
              </button>
              <button
                type="button"
                className={formState.defenderSlot === "player2" ? "is-selected" : ""}
                onClick={() => updateField("defenderSlot", "player2")}
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
              >
                Spieler 1
              </button>
              <button
                type="button"
                className={formState.startingSlot === "player2" ? "is-selected" : ""}
                onClick={() => updateField("startingSlot", "player2")}
              >
                Spieler 2
              </button>
            </div>
          </div>
        </section>

        <button type="submit" className="primary-button primary-button--large">
          Spiel anlegen
        </button>
      </form>
    </Layout>
  );
};
