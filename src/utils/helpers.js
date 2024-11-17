const winston = require("winston");

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "helpers" },
  transports: [
    new winston.transports.File({
      filename: "error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "helpers.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],

  exitOnError: false,
});

/**
 * Sanitizes user input to prevent XSS attacks.
 * @param {string} input - The input string to sanitize.
 * @returns {string} - The sanitized string. Returns an empty string if input is invalid.
 */
const sanitizeInput = (input) => {
  if (typeof input !== "string") {
    logger.error(
      "Invalid input type for sanitizeInput: Expected string, got",
      typeof input
    );
    return "";
  }

  if (!input.trim()) {
    return "";
  }

  const sanitizedInput = input
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .replace(/\\/g, "&#x5C;")
    .replace(/`/g, "&#x60;");

  return sanitizedInput;
};

/**
 * Handles errors gracefully and logs them using Winston.
 * @param {Error} error - The error object.
 * @param {string} message - A message to log.
 * @param {Object} [additionalContext] - Optional additional context for the error.
 */
const handleError = (
  error,
  message = "An error occurred",
  additionalContext = {}
) => {
  if (!error) {
    logger.error("handleError called with null/undefined error");
    return;
  }

  const errorDetails = {
    message: error.message,
    stack: error.stack,
    code: error.code,
    name: error.name,
    ...additionalContext,
    timestamp: new Date().toISOString(),
  };

  logger.error(`${message}: ${error.message}`, errorDetails);
};

/**
 * Creates a standardized error response object.
 * @param {string} message - The error message.
 * @param {number} [statusCode=500] - The HTTP status code.
 * @param {Object} [details] - Additional error details.
 * @returns {Object} Standardized error response object.
 */
const createErrorResponse = (message, statusCode = 500, details = {}) => {
  return {
    success: false,
    error: {
      message,
      statusCode,
      ...details,
      timestamp: new Date().toISOString(),
    },
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = Object.freeze({
  sanitizeInput,
  handleError,
  createErrorResponse,
  logger,
  sleep,
});
