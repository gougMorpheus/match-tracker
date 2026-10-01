const { runFactionColorsTests } = require("./factionColors.test.cjs");
const { runTvEventFeedTests } = require("./tvEventFeed.test.cjs");
const { runTvGameViewTests } = require("./tvGameView.test.cjs");
const { runHeadToHeadTests } = require("./headToHead.test.cjs");
const { runTvDashboardTests } = require("./tvDashboard.test.cjs");
const { runTvHighlightsTests } = require("./tvHighlights.test.cjs");
const { runServerSecondTickerTests } = require("./serverSecondTicker.test.cjs");
const { runRealtimeTests } = require("./realtime.test.cjs");
const { runServerClockTests } = require("./serverClock.test.cjs");
const { runGameStoreReadOnlyTests } = require("./gameStoreReadOnly.test.cjs");
const { runGameCalculationsTests } = require("./gameCalculations.test.cjs");
const { runGameAccessModeTests } = require("./gameAccessMode.test.cjs");
const { runGameSecurityTests } = require("./gameSecurity.test.cjs");
const { runLocalSyncTests } = require("./localSync.test.cjs");
const { runTimerFocusTests } = require("./timerFocus.test.cjs");

const suites = [
  ["factionColors", runFactionColorsTests],
  ["tvEventFeed", runTvEventFeedTests],
  ["tvGameView", runTvGameViewTests],
  ["headToHead", runHeadToHeadTests],
  ["tvDashboard", runTvDashboardTests],
  ["tvHighlights", runTvHighlightsTests],
  ["gameCalculations", runGameCalculationsTests],
  ["gameAccessMode", runGameAccessModeTests],
  ["gameSecurity", runGameSecurityTests],
  ["localSync", runLocalSyncTests],
  ["timerFocus", runTimerFocusTests],
  ["serverClock", runServerClockTests],
  ["serverSecondTicker", runServerSecondTickerTests],
  ["gameStoreReadOnly", runGameStoreReadOnlyTests],
  ["realtime", runRealtimeTests]
];

const main = async () => {
let failures = 0;

for (const [name, run] of suites) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`OK ${suites.length} suites`);
}

};
void main().catch((error) => { console.error(error); process.exitCode = 1; });
