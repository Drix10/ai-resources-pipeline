const mongoose = require("mongoose");

const tweetSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  text: { type: String, required: true },
  author_id: { type: String, required: true },
  created_at: { type: Date, required: true },
  entities: { type: Object, required: true },
  markdown: { type: String, required: true },
  conversation_id: { type: String, required: true },
});

tweetSchema.index({ id: 1 }, { unique: true });
tweetSchema.index({ created_at: 1 });

tweetSchema.statics.findTweets = async function (query) {
  try {
    return await this.find(query);
  } catch (error) {
    throw new Error("Failed to retrieve tweets from database");
  }
};

tweetSchema.statics.findById = async function (id) {
  try {
    const tweet = await this.findById(id);
    if (!tweet) {
      throw new Error("Tweet not found");
    }
    return tweet;
  } catch (error) {
    if (error.name === "CastError") {
      throw new Error("Invalid tweet ID");
    }
    throw new Error("Failed to retrieve tweet from database");
  }
};

tweetSchema.methods.save = async function () {
  try {
    return await this.model("Tweet").create(this);
  } catch (error) {
    if (error.name === "MongoError" && error.code === 11000) {
      throw new Error("Duplicate tweet ID");
    }
    throw new Error("Failed to save tweet to database");
  }
};

const Tweet = mongoose.model("Tweet", tweetSchema);

module.exports = Tweet;
