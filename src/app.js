const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const config = require("../config");
const dbConnection = require("../utils/dbConnection");
const tweetsRouter = require("./routes/tweets");
const githubRouter = require("./routes/github");

dotenv.config();
const app = express();
app.use(bodyParser.json());

app.use("/tweets", tweetsRouter);
app.use("/github", githubRouter);

const startServer = async () => {
  try {
    await dbConnection.connect(config.mongodb.uri);
    const port = config.server.port;
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

const handleError = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
};

app.use(handleError);

startServer();
