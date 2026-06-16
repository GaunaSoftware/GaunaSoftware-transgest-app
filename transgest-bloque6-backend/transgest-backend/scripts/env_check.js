require("dotenv").config();

const { validateEnv } = require("../src/services/envValidator");
const { getBackupStatus } = require("../src/services/backup");

function run() {
  const { critical, warnings } = validateEnv();
  if (critical.length) {
    console.error("ENV FAIL:");
    for (const item of critical) console.error("- " + item);
    process.exitCode = 1;
    return;
  }

  const backup = getBackupStatus();
  if (!backup.configured) {
    console.warn("ENV WARN: " + backup.message);
  }
  for (const item of warnings) console.warn("ENV WARN: " + item);
  console.log("OK env");
}

run();
