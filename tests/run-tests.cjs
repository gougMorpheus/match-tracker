const { runFactionColorsTests } = require("./factionColors.test.cjs");
const { runTvEventFeedTests } = require("./tvEventFeed.test.cjs");
const { runTvGameViewTests } = require("./tvGameView.test.cjs");
const { runEditViewOnlyTests } = require("./editViewOnly.test.cjs");
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
const { runSyncVersioningTests } = require("./syncVersioning.test.cjs");
const { runHighlightsScrollTests } = require("./highlightsScroll.test.cjs");
const { runPushATests } = require("./pushA.test.cjs");
const { runLeadHighlightsTests } = require("./leadHighlights.test.cjs");
const { runTvLeadPopupTests } = require("./tvLeadPopup.test.cjs");
const { runEventGroupingTests } = require("./eventGrouping.test.cjs");
const { runSchritt1Tests } = require("./schritt1.test.cjs");
const { runTimeEventOrderTests } = require("./timeEventOrder.test.cjs");
const { runRetestTests } = require("./retest.test.cjs");
const { runPushBTests } = require("./pushB.test.cjs");
const { runAbcTests, runRetest2Tests } = require("./abc.test.cjs");
const { runStatsExcludeTests } = require("./statsExclude.test.cjs");
const { runTurnSelectionTests } = require("./turnSelection.test.cjs");
const { runPushAboTests } = require("./pushAbo.test.cjs");
const { runAufstellungOrderTests } = require("./aufstellungOrder.test.cjs");
const { runPushZzTests } = require("./pushZz.test.cjs");
const { runAbgleichAutoCpTests } = require("./abgleichAutoCp.test.cjs");
const { runSpielzeileNachsendenTests } = require("./spielzeileNachsenden.test.cjs");
const { runDeltaAbgleichTests } = require("./deltaAbgleich.test.cjs");

const suites = [
  ["pushAbo", runPushAboTests],
  ["statsExclude", runStatsExcludeTests],
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
  ["realtime", runRealtimeTests],
  ["syncVersioning", runSyncVersioningTests],
  ["editViewOnly", runEditViewOnlyTests],
  ["highlightsScroll", runHighlightsScrollTests],
  ["pushA", runPushATests],
  ["leadHighlights", runLeadHighlightsTests],
  ["tvLeadPopup", runTvLeadPopupTests],
  ["eventGrouping", runEventGroupingTests],
  ["schritt1", runSchritt1Tests],
  ["timeEventOrder", runTimeEventOrderTests],
  ["retest", runRetestTests],
  ["pushB", runPushBTests],
  ["abc", runAbcTests],
  ["retest2", runRetest2Tests],
  ["turnSelection", runTurnSelectionTests],
  ["aufstellungOrder", runAufstellungOrderTests],
  ["pushZz", runPushZzTests],
  ["abgleichAutoCp", runAbgleichAutoCpTests],
  ["spielzeileNachsenden", runSpielzeileNachsendenTests],
  ["deltaAbgleich", runDeltaAbgleichTests]
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
// Haengende Promises duerfen nicht still mit Exit 0 enden.
let finished = false;
process.on("exit", (code) => { if (!finished && code === 0) { console.error("FAIL runner: unvollstaendig beendet"); process.exitCode = 1; } });
void main().then(() => { finished = true; }).catch((error) => { console.error(error); process.exitCode = 1; });
