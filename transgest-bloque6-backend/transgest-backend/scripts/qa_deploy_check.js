const { spawnSync } = require("child_process");
const path = require("path");

const baseUrl = (process.env.DEPLOY_BASE_URL || process.env.PUBLIC_APP_URL || "http://localhost").replace(/\/$/, "");

function runStep(name, script, extraEnv = {}) {
  console.log(`\n== ${name} ==`);
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
      DEPLOY_BASE_URL: baseUrl,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${name}: fallo con codigo ${result.status}`);
  }
}

try {
  runStep("Audit multiempresa", "audit_tenant.js", {
    STRICT_TENANT_AUDIT: "true",
  });
  runStep("Smoke publico", "deploy_smoke_check.js");
  runStep("Functional por proxy", "functional_check.js", {
    FUNCTIONAL_BASE_URL: baseUrl,
  });
  console.log(`\nQA DEPLOY OK: ${baseUrl}`);
} catch (err) {
  console.error(`\nQA DEPLOY FAIL: ${err.message}`);
  process.exitCode = 1;
}
