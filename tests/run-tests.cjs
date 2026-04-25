const { runGameCalculationsTests } = require("./gameCalculations.test.cjs");
const { runGameSecurityTests } = require("./gameSecurity.test.cjs");

const suites = [
  ["gameCalculations", runGameCalculationsTests],
  ["gameSecurity", runGameSecurityTests]
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
