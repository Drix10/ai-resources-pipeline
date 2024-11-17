const { logger, handleError } = require("../utils/helpers");
const config = require("../../config");
const TwitterService = require("./twitter");
const GeminiService = require("./gemini");
const GithubService = require("./github");
const Tweet = require("../models/tweet");
const axios = require("axios");
const dbConnection = require("../utils/dbConnection");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDataPipeline = async (retryCount = 0) => {
  const timestamp = new Date().toISOString();

  try {
    // Check database connection
    const connectionStatus = dbConnection.getConnectionStatus();
    if (!connectionStatus.isConnected) {
      throw new Error("Database connection not established");
    }

    logger.info(`Starting data pipeline at ${timestamp}`);

    // 1. Fetch tweets
    const tweets = await TwitterService.fetchTweets();
    if (!tweets.length) {
      logger.info("No new tweets to process");
      await sendDiscordNotification({
        success: true,
        tweetsProcessed: 0,
        timestamp,
        message: "No new tweets to process",
      });
      return;
    }
    logger.info(`Fetched ${tweets.length} tweets`);

    // 2. Process tweets with Gemini
    const processedTweets = await GeminiService.generateMarkdown(tweets);
    if (!processedTweets.length) {
      throw new Error("Failed to process tweets with Gemini");
    }
    logger.info(`Processed ${processedTweets.length} tweets with Gemini`);

    // 3. Save to MongoDB
    const savedTweets = await Tweet.insertMany(processedTweets, {
      ordered: false,
    }).catch((err) => {
      if (err.code === 11000) {
        logger.warn(
          `Some tweets were already in database: ${
            err.writeErrors?.length || 0
          } duplicates`
        );
        return err.insertedDocs;
      }
      throw err;
    });
    logger.info(`Saved ${savedTweets.length} tweets to MongoDB`);

    // 4. Generate and upload markdown file
    const markdownContent = processedTweets
      .map((tweet) => tweet.markdown)
      .join("\n\n---\n\n");
    const fileBuffer = Buffer.from(markdownContent);

    const uploadResult = await GithubService.uploadMarkdownFile(
      fileBuffer,
      config.github.repo,
      config.github.folder
    );
    logger.info(`Uploaded Markdown to GitHub: ${uploadResult.message}`);

    // 5. Send success notification
    await sendDiscordNotification({
      success: true,
      tweetsProcessed: tweets.length,
      savedTweets: savedTweets.length,
      timestamp,
      githubUrl: uploadResult.url,
    });

    return {
      success: true,
      tweetsProcessed: tweets.length,
      savedTweets: savedTweets.length,
      githubUrl: uploadResult.url,
    };
  } catch (error) {
    handleError(
      error,
      `Pipeline error (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      {
        retryCount,
        timestamp,
      }
    );

    const shouldRetry =
      retryCount < MAX_RETRIES &&
      (error.message?.includes("Rate limit") ||
        error.message?.includes("Network error") ||
        error.message?.includes("ECONNRESET") ||
        error.message?.includes("Database connection not established"));

    if (shouldRetry) {
      logger.info(`Retrying pipeline in ${RETRY_DELAY}ms...`);
      await sleep(RETRY_DELAY);
      return runDataPipeline(retryCount + 1);
    }

    await sendDiscordNotification({
      success: false,
      error: error.message,
      timestamp,
      retryCount,
    });

    throw error;
  }
};

async function sendDiscordNotification({
  success,
  tweetsProcessed = 0,
  savedTweets = 0,
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
        text: "Twitter to GitHub Pipeline",
      },
    };

    if (success) {
      if (message) {
        embed.description = message;
      } else {
        embed.fields.push(
          {
            name: "Tweets Processed",
            value: `${tweetsProcessed} tweets`,
            inline: true,
          },
          {
            name: "Tweets Saved",
            value: `${savedTweets} tweets`,
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
          name: "Retry Count",
          value: `${retryCount}/${MAX_RETRIES}`,
          inline: true,
        }
      );
    }

    await axios.post(config.discord.webhookUrl, {
      embeds: [embed],
    });

    logger.info("Sent Discord notification");
  } catch (webhookError) {
    handleError(webhookError, "Failed to send Discord notification", {
      success,
      webhookError: webhookError.message,
    });
  }
}

const initCronJob = () => {
  const schedule = config.cron?.schedule || "0 * * * *"; // Default to every hour

  try {
    const job = cron.schedule(schedule, async () => {
      logger.info(`Running scheduled pipeline at ${new Date().toISOString()}`);
      try {
        await runDataPipeline();
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
