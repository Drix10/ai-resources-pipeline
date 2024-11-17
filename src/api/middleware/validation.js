const { body, validationResult } = require("express-validator");

const tweetValidationRules = () => {
  return [
    body("content")
      .trim()
      .notEmpty()
      .withMessage("Tweet content cannot be empty")
      .isLength({ max: 280 })
      .withMessage("Tweet cannot exceed 280 characters"),
  ];
};

const validateGitHubRequest = () => {
  return [
    body("owner").trim().notEmpty().withMessage("Repository owner is required"),
    body("repo").trim().notEmpty().withMessage("Repository name is required"),
    body("path")
      .optional()
      .trim()
      .isString()
      .withMessage("Path must be a string"),
    body("branch")
      .optional()
      .trim()
      .isString()
      .withMessage("Branch must be a string"),
    body("message")
      .optional()
      .trim()
      .isString()
      .withMessage("Commit message must be a string"),
  ];
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

module.exports = {
  tweetValidationRules,
  validate,
  validateGitHubRequest,
};
