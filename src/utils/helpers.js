const winston = require("winston");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "helpers" },
  transports: [
    new winston.transports.File({ filename: "helpers.log", level: "info" }),
  ],
});

/**
 * Sanitizes user input to prevent XSS attacks.
 * @param {string} input - The input string to sanitize.
 * @returns {string} - The sanitized string.  Returns an empty string if input is invalid.
 */
const sanitizeInput = (input) => {
  if (typeof input !== "string") {
    logger.error(
      "Invalid input type for sanitizeInput: Expected string, got",
      typeof input
    );
    return "";
  }
  const sanitizedInput = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  return sanitizedInput;
};

/**
 *  Handles errors gracefully and logs them using Winston.
 * @param {Error} error - The error object.
 * @param {string} message -  A message to log.
 */
const handleError = (error, message) => {
  logger.error(`${message}: ${error.message}`, { stack: error.stack });
  //Consider adding more sophisticated error handling, like sending alerts or notifications, based on your application's requirements
};

module.exports = { sanitizeInput, handleError, logger };
