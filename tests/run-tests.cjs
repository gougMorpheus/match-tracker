const { runGameCalculationsTests } = require("./gameCalculations.test.cjs");
const { runGameAccessModeTests } = require("./gameAccessMode.test.cjs");
const { runGameSecurityTests } = require("./gameSecurity.test.cjs");
const { runLocalSyncTests } = require("./localSync.test.cjs");
const { runTimerFocusTests } = require("./timerFocus.test.cjs");

const suites = [
  ["gameCalculations", runGameCalculationsTests],
  ["gameAccessMode", runGameAccessModeTests],
  ["gameSecurity", runGameSecurityTests],
  ["localSync", runLocalSyncTests],
  ["timerFocus", runTimerFocusTests]
];

let failures = 0;

for (const [name, run] of suites) {
  try {
    run();
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
