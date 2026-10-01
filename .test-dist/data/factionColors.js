"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerColors = exports.getFactionColor = void 0;
const armies_1 = require("./armies");
// Bright faction accents chosen for readable strokes on the app's dark surfaces.
const colors = {
    "Adepta Sororitas": "#fb7185", "Adeptus Custodes": "#e7c978", "Adeptus Mechanicus": "#f87171",
    "Aeldari": "#67e8f9", "Astra Militarum": "#a3b880", "Black Templars": "#cbd5e1",
    "Blood Angels": "#fb7185", "Chaos Daemons": "#c084fc", "Chaos Knights": "#b99bd8",
    "Chaos Space Marines": "#f59e87", "Dark Angels": "#6ee7a0", "Death Guard": "#b4c77a",
    "Deathwatch": "#a8b5ce", "Drukhari": "#5eead4", "Genestealer Cults": "#c4b5fd",
    "Grey Knights": "#cbd5e1", "Imperial Agents": "#fda4af", "Imperial Knights": "#93c5fd",
    "Leagues of Votann": "#fdb98e", "Necrons": "#86efac", "Orks": "#a3e635",
    "Space Marines": "#60a5fa", "Space Wolves": "#94c9df", "Tau Empire": "#f5c18b",
    "Thousand Sons": "#38bdf8", "Tyranids": "#d8b4fe", "World Eaters": "#f87171"
};
const normalizedColors = Object.fromEntries(armies_1.ARMY_OPTIONS.map(name => [name.toLowerCase(), colors[name]]));
const getFactionColor = (name, slot) => normalizedColors[name.trim().toLowerCase()] ?? (slot === 0 ? "var(--accent)" : "#c4b5fd");
exports.getFactionColor = getFactionColor;
// Euclidean RGB distance below 100 marks visually close accents. Resolve the
// default accent for comparison only; keep the CSS variable in the returned pair.
const rgb = (color) => {
    const hex = color === "var(--accent)" ? "#38bdf8" : color;
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
};
const colorDistance = (a, b) => {
    const first = rgb(a), second = rgb(b);
    return Math.hypot(...first.map((channel, i) => channel - second[i]));
};
const getPlayerColors = (armyA, armyB) => {
    const first = (0, exports.getFactionColor)(armyA, 0), second = (0, exports.getFactionColor)(armyB, 1);
    if (colorDistance(first, second) >= 100)
        return [first, second];
    // Choose the most distant app accent, including when A itself is purple/gold.
    const alternatives = ["#c4b5fd", "#fbbf24"];
    const alternative = alternatives.reduce((best, candidate) => colorDistance(first, candidate) > colorDistance(first, best) ? candidate : best);
    return [first, alternative];
};
exports.getPlayerColors = getPlayerColors;
