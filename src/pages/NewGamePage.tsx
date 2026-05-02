import { useMemo, useState, type FormEvent } from "react";
import { GameMetaFields } from "../components/GameMetaFields";
import { GamePlayerFields } from "../components/GamePlayerFields";
import type { CreateGameInput } from "../types/game";
import { Layout } from "../components/Layout";
import { useGameStore } from "../store/GameStore";
import { buildGameFormOptions, getPlayerArmyComboKey } from "../utils/gameFormOptions";
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

export const NewGamePage = ({ onCreated, onBack }: NewGamePageProps) => {
  const { createGame, games, isMutating, errorMessage, clearError } = useGameStore();
  const [formState, setFormState] = useState<CreateGameInput>(() => createDefaultFormState());
  const {
    playerOptions,
    latestArmyByPlayerName,
    latestDetachmentByPlayerArmy,
    detachmentOptionsByArmy,
    deploymentOptions,
    primaryMissionOptions
  } = useMemo(() => buildGameFormOptions(games), [games]);

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

        <GamePlayerFields
          title="Spieler 1"
          nameValue={formState.playerOneName}
          armyValue={formState.playerOneArmy}
          detachmentValue={formState.playerOneDetachment}
          playerOptions={playerOptions}
          detachmentOptions={detachmentOptionsByArmy.get(formState.playerOneArmy) ?? []}
          disabled={isMutating}
          onNameChange={(value) => updateField("playerOneName", value)}
          onSelectRememberedName={(value) => applyRememberedPlayerName("player1", value)}
          onArmyChange={(value) => applyArmySelection("player1", value)}
          onDetachmentChange={(value) => updateField("playerOneDetachment", value)}
        />
        <GamePlayerFields
          title="Spieler 2"
          nameValue={formState.playerTwoName}
          armyValue={formState.playerTwoArmy}
          detachmentValue={formState.playerTwoDetachment}
          playerOptions={playerOptions}
          detachmentOptions={detachmentOptionsByArmy.get(formState.playerTwoArmy) ?? []}
          disabled={isMutating}
          onNameChange={(value) => updateField("playerTwoName", value)}
          onSelectRememberedName={(value) => applyRememberedPlayerName("player2", value)}
          onArmyChange={(value) => applyArmySelection("player2", value)}
          onDetachmentChange={(value) => updateField("playerTwoDetachment", value)}
        />
        <GameMetaFields
          value={formState}
          deploymentOptions={deploymentOptions}
          primaryMissionOptions={primaryMissionOptions}
          disabled={isMutating}
          onChange={updateField}
        />

        <button type="submit" className="primary-button primary-button--large" disabled={isMutating}>
          {isMutating ? "Speichere..." : "Spiel anlegen"}
        </button>
      </form>
    </Layout>
  );
};
