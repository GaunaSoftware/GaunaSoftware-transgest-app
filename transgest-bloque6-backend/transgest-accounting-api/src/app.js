require("./resolveWorkspaceModules");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const crypto = require("crypto");
const config = require("./services/config");
const db = require("./services/db");
const logger = require("./services/logger");
const auditRoutes = require("./routes/audit");
const accountsRoutes = require("./routes/accounts");
const authRoutes = require("./routes/auth");
const banksRoutes = require("./routes/banks");
const chartTemplatesRoutes = require("./routes/chartTemplates");
const companiesRoutes = require("./routes/companies");
const dashboardRoutes = require("./routes/dashboard");
const journalEntriesRoutes = require("./routes/journalEntries");
const ledgerRoutes = require("./routes/ledger");
const maturitiesRoutes = require("./routes/maturities");
const outboxRoutes = require("./routes/outbox");
const partiesRoutes = require("./routes/parties");
const periodsRoutes = require("./routes/periods");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    req.id = req.headers["x-request-id"] || crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  });
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(compression());
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (!config.corsOrigins.length) return cb(null, true);
      return cb(null, config.corsOrigins.includes(origin));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("combined", {
    stream: { write: msg => logger.info({ msg: "http_request", line: msg.trim() }) },
  }));

  app.get("/health", async (req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ok", service: "transgest-accounting-api", db: "connected", ts: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "error", service: "transgest-accounting-api", db: "disconnected" });
    }
  });

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/companies", companiesRoutes);
  app.use("/api/v1", accountsRoutes);
  app.use("/api/v1", banksRoutes);
  app.use("/api/v1", chartTemplatesRoutes);
  app.use("/api/v1", dashboardRoutes);
  app.use("/api/v1", journalEntriesRoutes);
  app.use("/api/v1", ledgerRoutes);
  app.use("/api/v1", maturitiesRoutes);
  app.use("/api/v1", partiesRoutes);
  app.use("/api/v1", auditRoutes);
  app.use("/api/v1", outboxRoutes);
  app.use("/api/v1", periodsRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
  });

  app.use((err, req, res, next) => {
    logger.error({ msg: "request_error", request_id: req.id, path: req.path, error: err.message, stack: err.stack });
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      error: status < 500 ? err.message : "Error interno del servicio contable",
      request_id: req.id,
    });
  });

  return app;
}

module.exports = { createApp };
