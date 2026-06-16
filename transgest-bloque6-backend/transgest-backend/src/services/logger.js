const { createLogger, format, transports } = require("winston");
const path = require("path");

const isProduction = process.env.NODE_ENV === "production";

const logger = createLogger({
  level: isProduction ? "info" : "debug",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    isProduction ? format.json() : format.combine(
      format.colorize(),
      format.printf(({ timestamp, level, message, ...rest }) => {
        const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
        return `${timestamp} [${level}] ${message}${extra}`;
      })
    )
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024,   // 10MB
      maxFiles: 5,
    }),
    new transports.File({
      filename: path.join("logs", "combined.log"),
      maxsize: 20 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

module.exports = logger;
