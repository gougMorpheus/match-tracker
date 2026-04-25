"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGameFormOptions = exports.getPlayerArmyComboKey = exports.getSortedUniqueValues = void 0;
const presets_1 = require("./presets");
const getSortedUniqueValues = (values) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
exports.getSortedUniqueValues = getSortedUniqueValues;
const getPlayerArmyComboKey = (playerName, armyName) => {
    const normalizedPlayerName = playerName.trim().toLocaleLowerCase();
    const normalizedArmyName = armyName.trim().toLocaleLowerCase();
    if (!normalizedPlayerName || !normalizedArmyName) {
        return null;
    }
    return `${normalizedPlayerName}::${normalizedArmyName}`;
};
exports.getPlayerArmyComboKey = getPlayerArmyComboKey;
const buildGameFormOptions = (games) => {
    const playerOptions = (0, exports.getSortedUniqueValues)([
        ...(0, presets_1.loadRememberedPlayerNames)(),
        ...games.flatMap((game) => game.players.map((player) => player.name))
    ]);
    const latestArmyByPlayerName = new Map();
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
    const latestDetachmentByPlayerArmy = new Map();
    [...games]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .forEach((game) => {
        game.players.forEach((player) => {
            const comboKey = (0, exports.getPlayerArmyComboKey)(player.name, player.army.name);
            const detachment = player.army.detachment.trim();
            if (!comboKey || latestDetachmentByPlayerArmy.has(comboKey) || !detachment) {
                return;
            }
            latestDetachmentByPlayerArmy.set(comboKey, detachment);
        });
    });
    const detachmentOptionsByArmy = new Map();
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
        deploymentOptions: (0, exports.getSortedUniqueValues)(games.map((game) => game.deployment)),
        primaryMissionOptions: (0, exports.getSortedUniqueValues)(games.map((game) => game.primaryMission))
    };
};
exports.buildGameFormOptions = buildGameFormOptions;
