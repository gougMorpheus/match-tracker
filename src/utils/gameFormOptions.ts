import type { Game } from "../types/game";
import { loadRememberedPlayerNames } from "./presets";

export interface GameFormOptions {
  playerOptions: string[];
  latestArmyByPlayerName: Map<string, string>;
  latestDetachmentByPlayerArmy: Map<string, string>;
  detachmentOptionsByArmy: Map<string, string[]>;
  deploymentOptions: string[];
  primaryMissionOptions: string[];
}

export const getSortedUniqueValues = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

export const getPlayerArmyComboKey = (playerName: string, armyName: string): string | null => {
  const normalizedPlayerName = playerName.trim().toLocaleLowerCase();
  const normalizedArmyName = armyName.trim().toLocaleLowerCase();
  if (!normalizedPlayerName || !normalizedArmyName) {
    return null;
  }

  return `${normalizedPlayerName}::${normalizedArmyName}`;
};

export const buildGameFormOptions = (games: Game[]): GameFormOptions => {
  const playerOptions = getSortedUniqueValues([
    ...loadRememberedPlayerNames(),
    ...games.flatMap((game) => game.players.map((player) => player.name))
  ]);

  const latestArmyByPlayerName = new Map<string, string>();
  [...games]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .forEach((game) => {
      game.players.forEach((player) => {
        const normalizedName = player.name.trim();
        if (!normalizedName || latestArmyByPlayerName.has(normalizedName)) {
          return;
        }

        latestArmyByPlayerName.set(normalizedName, player.army.name);
      });
    });

  const latestDetachmentByPlayerArmy = new Map<string, string>();
  [...games]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .forEach((game) => {
      game.players.forEach((player) => {
        const comboKey = getPlayerArmyComboKey(player.name, player.army.name);
        const detachment = player.army.detachment.trim();
        if (!comboKey || latestDetachmentByPlayerArmy.has(comboKey) || !detachment) {
          return;
        }

        latestDetachmentByPlayerArmy.set(comboKey, detachment);
      });
    });

  const detachmentOptionsByArmy = new Map<string, string[]>();
  games.forEach((game) => {
    game.players.forEach((player) => {
      const armyName = player.army.name.trim();
      const detachment = player.army.detachment.trim();
      if (!armyName || !detachment) {
        return;
      }

      const current = detachmentOptionsByArmy.get(armyName) ?? [];
      if (!current.includes(detachment)) {
        detachmentOptionsByArmy.set(armyName, [...current, detachment].sort((left, right) => left.localeCompare(right)));
      }
    });
  });

  return {
    playerOptions,
    latestArmyByPlayerName,
    latestDetachmentByPlayerArmy,
    detachmentOptionsByArmy,
    deploymentOptions: getSortedUniqueValues(games.map((game) => game.deployment)),
    primaryMissionOptions: getSortedUniqueValues(games.map((game) => game.primaryMission))
  };
};
