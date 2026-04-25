import { useMemo, useState, type FormEvent } from "react";
import { ARMY_OPTIONS } from "../data/armies";
import { SelectOrCreateField } from "../components/SelectOrCreateField";
import type { CreateGameInput } from "../types/game";
import { Layout } from "../components/Layout";
import { useGameStore } from "../store/GameStore";
import { loadRememberedPlayerNames } from "../utils/presets";
import { toLocalDateInput, toLocalTimeInput } from "../utils/time";

interface NewGamePageProps {
  onCreated: (gameId: string) => void;
  onBack: () => void;
}

const createDefaultFormState = (): CreateGameInput => ({
  playerOneName: "",
  playerOneArmy: "",
  playerOneDetachment: "",
  playerTwoName: "",
  playerTwoArmy: "",
  playerTwoDetachment: "",
  gamePoints: 1000,
  scheduledDate: toLocalDateInput(),
  scheduledTime: toLocalTimeInput(),
  deployment: "",
  primaryMission: "",
  defenderSlot: "player1",
  startingSlot: "player1"
});

const getSortedUniqueValues = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

export const NewGamePage = ({ onCreated, onBack }: NewGamePageProps) => {
  const { createGame, games, isMutating, errorMessage, clearError } = useGameStore();
  const [formState, setFormState] = useState<CreateGameInput>(() => createDefaultFormState());
  const playerOptions = useMemo(
    () =>
      getSortedUniqueValues([
        ...loadRememberedPlayerNames(),
        ...games.flatMap((game) => game.players.map((player) => player.name))
      ]),
    [games]
  );
  const latestArmyByPlayerName = useMemo(() => {
    const armyByName = new Map<string, string>();
    [...games]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .forEach((game) => {
        game.players.forEach((player) => {
          const normalizedName = player.name.trim();
          if (!normalizedName || armyByName.has(normalizedName)) {
            return;
          }

          armyByName.set(normalizedName, player.army.name);
        });
      });

    return armyByName;
  }, [games]);
  const latestDetachmentByPlayerArmy = useMemo(() => {
    const detachmentByCombo = new Map<string, string>();
    [...games]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .forEach((game) => {
        game.players.forEach((player) => {
          const comboKey = `${player.name.trim().toLocaleLowerCase()}::${player.army.name.trim().toLocaleLowerCase()}`;
          const detachment = player.army.detachment.trim();
          if (!comboKey || detachmentByCombo.has(comboKey) || !detachment) {
            return;
          }

          detachmentByCombo.set(comboKey, detachment);
        });
      });

    return detachmentByCombo;
  }, [games]);
  const detachmentOptionsByArmy = useMemo(() => {
    const detachments = new Map<string, string[]>();
    games.forEach((game) => {
      game.players.forEach((player) => {
        const armyName = player.army.name.trim();
        const detachment = player.army.detachment.trim();
        if (!armyName || !detachment) {
          return;
        }

        const current = detachments.get(armyName) ?? [];
        if (!current.includes(detachment)) {
          detachments.set(armyName, [...current, detachment].sort((left, right) => left.localeCompare(right)));
        }
      });
    });

    return detachments;
  }, [games]);
  const deploymentOptions = useMemo(
    () => getSortedUniqueValues(games.map((game) => game.deployment)),
    [games]
  );
  const primaryMissionOptions = useMemo(
    () => getSortedUniqueValues(games.map((game) => game.primaryMission)),
    [games]
  );

  const getPlayerArmyComboKey = (playerName: string, armyName: string): string | null => {
    const normalizedPlayerName = playerName.trim().toLocaleLowerCase();
    const normalizedArmyName = armyName.trim().toLocaleLowerCase();
    if (!normalizedPlayerName || !normalizedArmyName) {
      return null;
    }

    return `${normalizedPlayerName}::${normalizedArmyName}`;
  };

  function updateField<K extends keyof CreateGameInput>(key: K, value: CreateGameInput[K]) {
    setFormState((current) => ({
      ...current,
      [key]: value
    }));
  }

  function applyRememberedPlayerName(slot: "player1" | "player2", value: string) {
    const armyField = slot === "player1" ? "playerOneArmy" : "playerTwoArmy";
    const nameField = slot === "player1" ? "playerOneName" : "playerTwoName";
    const detachmentField = slot === "player1" ? "playerOneDetachment" : "playerTwoDetachment";
    const rememberedArmy = latestArmyByPlayerName.get(value.trim());

    setFormState((current) => {
      const nextArmy = rememberedArmy || current[armyField];
      const comboKey = getPlayerArmyComboKey(value, String(nextArmy));
      const rememberedDetachment = comboKey ? latestDetachmentByPlayerArmy.get(comboKey) : undefined;

      return {
        ...current,
        [nameField]: value,
        [armyField]: nextArmy,
        [detachmentField]: rememberedDetachment || current[detachmentField]
      };
    });
  }

  function applyArmySelection(slot: "player1" | "player2", army: string) {
    const nameField = slot === "player1" ? "playerOneName" : "playerTwoName";
    const armyField = slot === "player1" ? "playerOneArmy" : "playerTwoArmy";
    const detachmentField = slot === "player1" ? "playerOneDetachment" : "playerTwoDetachment";

    setFormState((current) => {
      const comboKey = getPlayerArmyComboKey(String(current[nameField]), army);
      const rememberedDetachment = comboKey ? latestDetachmentByPlayerArmy.get(comboKey) : undefined;

      return {
        ...current,
        [armyField]: army,
        [detachmentField]: rememberedDetachment || current[detachmentField]
      };
    });
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
          <SelectOrCreateField
            label="Name"
            value={formState.playerOneName}
            options={playerOptions}
            required
            disabled={isMutating}
            selectPlaceholder="Spieler waehlen"
            inputPlaceholder="Neuen Namen eingeben"
            onChange={(value) => updateField("playerOneName", value)}
            onSelectOption={(value) => applyRememberedPlayerName("player1", value)}
          />
          <label className="field">
            <span>Armee</span>
            <select
              required
              value={formState.playerOneArmy}
              onChange={(event) => applyArmySelection("player1", event.target.value)}
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
          <SelectOrCreateField
            label="Detachment (optional)"
            value={formState.playerOneDetachment}
            options={detachmentOptionsByArmy.get(formState.playerOneArmy) ?? []}
            disabled={isMutating}
            selectPlaceholder="Detachment waehlen"
            inputPlaceholder="Neues Detachment eingeben"
            onChange={(value) => updateField("playerOneDetachment", value)}
          />
        </section>

        <section className="card stack">
          <h2>Spieler 2</h2>
          <SelectOrCreateField
            label="Name"
            value={formState.playerTwoName}
            options={playerOptions}
            required
            disabled={isMutating}
            selectPlaceholder="Spieler waehlen"
            inputPlaceholder="Neuen Namen eingeben"
            onChange={(value) => updateField("playerTwoName", value)}
            onSelectOption={(value) => applyRememberedPlayerName("player2", value)}
          />
          <label className="field">
            <span>Armee</span>
            <select
              required
              value={formState.playerTwoArmy}
              onChange={(event) => applyArmySelection("player2", event.target.value)}
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
          <SelectOrCreateField
            label="Detachment (optional)"
            value={formState.playerTwoDetachment}
            options={detachmentOptionsByArmy.get(formState.playerTwoArmy) ?? []}
            disabled={isMutating}
            selectPlaceholder="Detachment waehlen"
            inputPlaceholder="Neues Detachment eingeben"
            onChange={(value) => updateField("playerTwoDetachment", value)}
          />
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
          <div className="two-column-grid game-scheduling-grid">
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
          <SelectOrCreateField
            label="Aufstellung (optional)"
            value={formState.deployment}
            options={deploymentOptions}
            disabled={isMutating}
            selectPlaceholder="Aufstellung waehlen"
            inputPlaceholder="Neue Aufstellung eingeben"
            onChange={(value) => updateField("deployment", value)}
          />
          <SelectOrCreateField
            label="Primaermission (optional)"
            value={formState.primaryMission}
            options={primaryMissionOptions}
            disabled={isMutating}
            selectPlaceholder="Primaermission waehlen"
            inputPlaceholder="Neue Primaermission eingeben"
            onChange={(value) => updateField("primaryMission", value)}
          />

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
