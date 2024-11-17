const mongoose = require("mongoose");
const { logger } = require("./helpers");

class DbConnection {
  constructor() {
    this.isConnected = false;
    mongoose.connection.on("connected", () => {
      this.isConnected = true;
      logger.info("MongoDB connection established");
    });

    mongoose.connection.on("disconnected", () => {
      this.isConnected = false;
      logger.info("MongoDB disconnected");
    });

    mongoose.connection.on("error", (err) => {
      this.isConnected = false;
      logger.error("MongoDB connection error:", err);
    });
  }

  async connect(uri) {
    try {
      if (this.isConnected) {
        logger.info("Using existing database connection");
        return;
      }

      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 45000,
        socketTimeoutMS: 45000,
      });

      this.isConnected = true;
    } catch (error) {
      this.isConnected = false;
      logger.error("Database connection error:", error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (!this.isConnected) {
        logger.info("No active database connection to close");
        return;
      }

      await mongoose.disconnect();
      this.isConnected = false;
      logger.info("Database connection closed");
    } catch (error) {
      logger.error("Error disconnecting from database:", error);
      throw error;
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      state: mongoose.connection.readyState,
    };
  }
}

module.exports = new DbConnection();
