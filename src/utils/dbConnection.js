const { MongoClient } = require("mongodb");
const { logger } = require("../utils/helpers");

class DbConnection {
  constructor() {
    this.client = null;
    this.db = null;
  }

  async connect(uri) {
    if (!uri) {
      throw new Error("MongoDB URI is required.");
    }
    try {
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db();
      logger.info("Successfully connected to MongoDB.");
      return this.db;
    } catch (error) {
      logger.error("Failed to connect to MongoDB:", error);
      throw new Error("Failed to connect to MongoDB.");
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
        logger.info("Successfully disconnected from MongoDB.");
      } catch (error) {
        logger.error("Failed to disconnect from MongoDB:", error);
        throw new Error("Failed to disconnect from MongoDB.");
      }
    }
  }

  getDb() {
    return this.db;
  }
}

module.exports = new DbConnection();
