const mongoose = require("mongoose");
const { logger } = require("../utils/helpers");

// Schema for links within tweets
const linkSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    title: String,
    description: String,
  },
  { _id: false }
);

// Schema for code snippets
const codeSnippetSchema = new mongoose.Schema(
  {
    language: String,
    code: { type: String, required: true },
  },
  { _id: false }
);

// Schema for thread tweets
const threadTweetSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    created_at: { type: Date, required: true },
    links: [linkSchema],
    code_snippets: [String],
    mentions: [String],
    hashtags: [String],
  },
  { _id: false }
);

// Main tweet schema
const tweetSchema = new mongoose.Schema(
  {
    // Basic tweet information
    id: { type: String, required: true, unique: true },
    conversation_id: { type: String, required: true, index: true },
    author_id: { type: String, required: true, index: true },
    created_at: { type: Date, required: true, index: true },

    // Content
    thread: [threadTweetSchema],
    topics: [{ type: String, index: true }],

    // Processed content
    markdown: { type: String, required: true },

    // Metadata
    entities: {
      urls: [linkSchema],
      mentions: [String],
      hashtags: [String],
    },

    // Processing metadata
    processed_at: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["pending", "processed", "failed"],
      default: "pending",
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    strict: true,
  }
);

// Indexes
tweetSchema.index({ id: 1 }, { unique: true });
tweetSchema.index({ created_at: 1 });
tweetSchema.index({ topics: 1 });
tweetSchema.index({ "entities.hashtags": 1 });
tweetSchema.index({ status: 1 });

// Static methods
tweetSchema.statics = {
  async findTweets(query = {}, options = {}) {
    try {
      this.checkConnection();
      return await this.find(query)
        .sort(options.sort || { created_at: -1 })
        .limit(options.limit || 100)
        .lean();
    } catch (error) {
      this.handleError(error, "Error finding tweets");
    }
  },

  async findByTweetId(tweetId) {
    try {
      this.checkConnection();
      const tweet = await this.findOne({ id: tweetId }).lean();
      if (!tweet) {
        throw new Error("Tweet not found");
      }
      return tweet;
    } catch (error) {
      this.handleError(error, "Error finding tweet by ID");
    }
  },

  async findByConversationId(conversationId) {
    try {
      this.checkConnection();
      return await this.find({ conversation_id: conversationId })
        .sort({ created_at: 1 })
        .lean();
    } catch (error) {
      this.handleError(error, "Error finding tweets by conversation ID");
    }
  },

  async findByTopics(topics) {
    try {
      this.checkConnection();
      return await this.find({ topics: { $in: topics } })
        .sort({ created_at: -1 })
        .lean();
    } catch (error) {
      this.handleError(error, "Error finding tweets by topics");
    }
  },

  async saveTweets(tweets) {
    try {
      this.checkConnection();
      return await this.insertMany(tweets, {
        ordered: false,
        lean: true,
      });
    } catch (error) {
      if (error.code === 11000) {
        logger.warn(
          `Duplicate tweets found: ${error.writeErrors?.length || 0}`
        );
        return error.insertedDocs || [];
      }
      this.handleError(error, "Error saving tweets");
    }
  },

  checkConnection() {
    if (mongoose.connection.readyState !== mongoose.STATES.connected) {
      throw new Error("Database connection is not established");
    }
  },

  handleError(error, message) {
    logger.error(message, {
      error: error.message,
      stack: error.stack,
      code: error.code,
    });

    if (error.name === "CastError") {
      throw new Error("Invalid ID format");
    }
    if (error.code === 11000) {
      throw new Error("Duplicate tweet");
    }
    throw new Error(`${message}: ${error.message}`);
  },
};

// Instance methods
tweetSchema.methods = {
  async markAsProcessed() {
    try {
      this.status = "processed";
      this.processed_at = new Date();
      await this.save();
    } catch (error) {
      logger.error("Error marking tweet as processed:", {
        tweetId: this.id,
        error: error.message,
      });
      throw error;
    }
  },

  async updateMarkdown(markdown) {
    try {
      this.markdown = markdown;
      this.status = "processed";
      this.processed_at = new Date();
      await this.save();
    } catch (error) {
      logger.error("Error updating tweet markdown:", {
        tweetId: this.id,
        error: error.message,
      });
      throw error;
    }
  },
};

// Middleware
tweetSchema.pre("save", function (next) {
  if (this.isNew) {
    this.processed_at = new Date();
  }
  next();
});

const Tweet = mongoose.model("Tweet", tweetSchema);

module.exports = Tweet;
