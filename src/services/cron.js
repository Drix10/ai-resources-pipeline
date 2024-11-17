const { logger, handleError } = require("../utils/helpers");
const config = require("../../config");
const TwitterService = require("./twitter");
const GithubService = require("./github");
const axios = require("axios");
const mongoose = require("mongoose");
const { Tweet } = require("../utils/dbConnection");
const cron = require("node-cron");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const MIN_REQUIRED_TWEETS = config.minRequiredTweets;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDataPipeline = async (retryCount = 0) => {
  const timestamp = new Date().toISOString();
  const pipelineStats = {
    tweetsFound: 0,
    tweetsProcessed: 0,
    tweetsSaved: 0,
    markdownGenerated: false,
    githubUploaded: false,
    errors: [],
  };

  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error("Database connection not established");
    }

    logger.info(`Starting data pipeline at ${timestamp}`);

    const tweets = await TwitterService.fetchTweets();
    pipelineStats.tweetsFound = tweets.length;

    if (!tweets.length) {
      await sendDiscordNotification({
        success: true,
        stats: pipelineStats,
        timestamp,
        message: "No new tweets to process",
      });
      return pipelineStats;
    }
    logger.info(`Fetched ${tweets.length} tweets`);

    if (tweets.length < MIN_REQUIRED_TWEETS) {
      logger.info(
        `Insufficient tweets (${tweets.length}/${MIN_REQUIRED_TWEETS}) to generate markdown`
      );
      return pipelineStats;
    }

    const result = await GithubService.createMarkdownFileFromTweets(tweets);

    if (!result.success) {
      throw new Error("Failed to create and upload markdown file");
    }

    pipelineStats.markdownGenerated = true;
    pipelineStats.githubUploaded = true;
    pipelineStats.tweetsProcessed = tweets.length;

    const savedTweets = await Tweet.updateMany(
      { url: { $in: tweets.map((t) => t.url) } },
      {
        $set: {
          status: "processed",
          processed_at: new Date(),
        },
      }
    );

    pipelineStats.tweetsSaved = savedTweets.modifiedCount;
    logger.info(`Updated ${savedTweets.modifiedCount} tweets in database`);

    await sendDiscordNotification({
      success: true,
      stats: pipelineStats,
      timestamp,
      githubUrl: result.url,
      message: `Successfully processed ${tweets.length} tweets and created markdown file`,
    });

    return pipelineStats;
  } catch (error) {
    handleError(
      error,
      `Pipeline error (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      { retryCount, timestamp, stats: pipelineStats }
    );

    const retryableErrors = [
      "Rate limit",
      "Network error",
      "ECONNRESET",
      "Database connection not established",
      "socket hang up",
      "ETIMEDOUT",
    ];

    const shouldRetry =
      retryCount < MAX_RETRIES &&
      (retryableErrors.some((e) => error.message?.includes(e)) ||
        error.code === "ECONNRESET");

    if (shouldRetry) {
      logger.info(`Retrying pipeline in ${RETRY_DELAY}ms...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
      return runDataPipeline(retryCount + 1);
    }

    await sendDiscordNotification({
      success: false,
      stats: pipelineStats,
      error: error.message,
      timestamp,
      retryCount,
    });

    throw error;
  }
};

async function sendDiscordNotification({
  success,
  stats = {},
  error = null,
  timestamp,
  retryCount = 0,
  githubUrl = null,
  message = null,
}) {
  if (!config.discord?.webhookUrl) {
    logger.warn("Discord notification skipped - webhook URL not configured");
    return;
  }

  try {
    const embed = {
      title: `Pipeline ${success ? "Success" : "Error"}`,
      color: success ? 0x00ff00 : 0xff0000,
      timestamp: new Date().toISOString(),
      fields: [
        {
          name: "Status",
          value: success ? "✅ Completed Successfully" : "❌ Failed",
          inline: true,
        },
        {
          name: "Timestamp",
          value: timestamp,
          inline: true,
        },
      ],
      footer: {
        text: `Twitter to GitHub Pipeline | ${new Date().toLocaleDateString()}`,
      },
    };

    if (success) {
      if (message) {
        embed.description = message;
      } else {
        embed.fields.push(
          {
            name: "Tweets Found",
            value: `${stats.tweetsFound || 0}`,
            inline: true,
          },
          {
            name: "Processed",
            value: `${stats.tweetsProcessed || 0}`,
            inline: true,
          },
          {
            name: "Saved",
            value: `${stats.tweetsSaved || 0}`,
            inline: true,
          }
        );

        if (githubUrl) {
          embed.fields.push({
            name: "GitHub URL",
            value: githubUrl,
            inline: false,
          });
        }
      }
    } else {
      embed.fields.push(
        {
          name: "Error Details",
          value: `\`\`\`\n${error}\n\`\`\``,
          inline: false,
        },
        {
          name: "Pipeline Progress",
          value: Object.entries(stats)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n"),
          inline: false,
        },
        {
          name: "Retry Count",
          value: `${retryCount}/${MAX_RETRIES}`,
          inline: true,
        }
      );
    }

    await axios.post(config.discord.webhookUrl, { embeds: [embed] });
    logger.info("Sent Discord notification");
  } catch (webhookError) {
    handleError(webhookError, "Failed to send Discord notification", {
      success,
      webhookError: webhookError.message,
    });
  }
}

const initCronJob = () => {
  const schedule = config.cron?.schedule || "0 * * * *";

  try {
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }

    const job = cron.schedule(schedule, async () => {
      const startTime = Date.now();
      logger.info(`Running scheduled pipeline at ${new Date().toISOString()}`);

      try {
        const stats = await runDataPipeline();
        const duration = Date.now() - startTime;
        logger.info(`Pipeline completed in ${duration}ms`, { stats });
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);
      }
    });

    logger.info(`Cron job initialized with schedule: ${schedule}`);
    return job;
  } catch (error) {
    logger.error("Failed to initialize cron job:", error);
    throw error;
  }
};

module.exports = {
  runDataPipeline,
  initCronJob,
  sendDiscordNotification,
};
