const { createApp } = require("./app");
const config = require("./services/config");
const logger = require("./services/logger");

const app = createApp();

app.listen(config.port, () => {
  logger.info({ msg: "accounting_api_started", port: config.port });
});
