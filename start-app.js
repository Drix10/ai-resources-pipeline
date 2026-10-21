#!/usr/bin/env node
const path = require("path");
// The repo's .env before anything else: helpers.js picks the log level from NODE_ENV as it loads.
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("./index.js");
