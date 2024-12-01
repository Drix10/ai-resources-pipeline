const mongoose = require("mongoose");
const { logger } = require("./helpers");

const tweetSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      minLength: 50,
    },
    links: [
      {
        type: String,
        validate: {
          validator: function (v) {
            try {
              new URL(v);
              return true;
            } catch (e) {
              return false;
            }
          },
          message: "Invalid URL format",
        },
      },
    ],
    status: {
      type: String,
      enum: ["pending", "processed", "failed"],
      default: "pending",
      index: true,
    },
    processed_at: {
      type: Date,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

tweetSchema.index({ status: 1, processed_at: -1 });
tweetSchema.index({ links: 1, status: 1 });

tweetSchema.statics.findUnprocessed = function () {
  return this.find({ status: "pending" })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
};

tweetSchema.statics.markAsProcessed = async function (tweetId) {
  return this.findByIdAndUpdate(tweetId, {
    status: "processed",
    processed_at: new Date(),
  });
};

tweetSchema.statics.handleError = function (error, message) {
  logger.error(message, {
    error: error.message,
    code: error.code,
  });

  if (error.code === 11000) {
    logger.warn("Duplicate tweet detected");
    return null;
  }
  throw error;
};

mongoose.connection.on("connected", () => {
  logger.info("MongoDB connection established");
});

mongoose.connection.on("disconnected", () => {
  logger.info("MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  logger.error("MongoDB connection error:", err);
});

const connect = async (uri) => {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 45000,
      socketTimeoutMS: 45000,
    });
  } catch (error) {
    logger.error("Database connection error:", error);
    throw error;
  }
};

const Tweet = mongoose.model("Tweet", tweetSchema);

module.exports = {
  connect,
  disconnect: () => mongoose.disconnect(),
  Tweet,
};
