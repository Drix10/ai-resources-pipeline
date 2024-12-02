const { logger, handleError } = require("../utils/helpers");
const config = require("../../config");
const TwitterService = require("./twitter");
const GithubService = require("./github");
const axios = require("axios");
const cron = require("node-cron");
const mongoose = require("mongoose");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDataPipeline = async (retryCount = 0) => {
  const stats = {
    startTime: new Date(),
    endTime: null,
    threadsProcessed: 0,
    linksFound: 0,
    markdownGenerated: false,
    errors: [],
  };

  try {
    const result = await TwitterService.fetchTweets();
    if (!result || !Array.isArray(result.threads)) {
      throw new Error("No valid tweets returned from Twitter service");
    }

    stats.threadsProcessed = result.threads.length;

    if (result.threads.length > 0) {
      const githubResult = await GithubService.createMarkdownFileFromTweets(
        result.threads,
        result.queryType
      );
      if (!githubResult?.success) {
        throw new Error("Failed to create and upload markdown file");
      }

      stats.markdownGenerated = true;
      stats.queryType = result.queryType;
    }

    stats.linksFound = result.threads.reduce((total, thread) => {
      if (thread?.tweets) {
        return (
          total +
          thread.tweets.reduce(
            (threadTotal, tweet) => threadTotal + (tweet.links?.length || 0),
            0
          )
        );
      }
      return total;
    }, 0);

    stats.endTime = new Date();
    return stats;
  } catch (error) {
    handleError(
      error,
      `Pipeline error (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      {
        retryCount,
        stats,
      }
    );

    if (retryCount < MAX_RETRIES) {
      logger.info(`Retrying in ${RETRY_DELAY}ms...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
      return runDataPipeline(retryCount + 1);
    }

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
            name: "Threads Processed",
            value: `${stats.threadsProcessed || 0}`,
            inline: true,
          },
          {
            name: "Links Found",
            value: `${stats.linksFound || 0}`,
            inline: true,
          },
          {
            name: "Markdown Generated",
            value: `${stats.markdownGenerated || false}`,
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

let scheduledJob = null;

const initCronJob = () => {
  try {
    if (scheduledJob) {
      logger.warn("Cron job already initialized");
      return scheduledJob;
    }

    const schedule = config.cron?.schedule || "0 */5 * * *";
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }

    logger.info("Running initial pipeline execution...");
    runInitialPipeline();

    scheduledJob = cron.schedule(
      schedule,
      async () => {
        const startTime = Date.now();
        const timestamp = new Date().toISOString();
        logger.info(`Running scheduled pipeline at ${timestamp}`);

        try {
          if (mongoose.connection.readyState !== 1) {
            throw new Error("Database connection not established");
          }

          const stats = await runDataPipeline();
          const duration = Date.now() - startTime;
          logger.info(`Pipeline completed in ${duration}ms`, { stats });

          await sendDiscordNotification({
            success: true,
            stats,
            timestamp,
            githubUrl: stats.githubUrl,
          });
        } catch (error) {
          logger.error("Scheduled pipeline failed:", error);

          await sendDiscordNotification({
            success: false,
            error: error.message,
            stats: error.stats || {},
            timestamp,
            retryCount: error.retryCount || MAX_RETRIES,
          });

          if (mongoose.connection.readyState !== 1) {
            try {
              await mongoose.connect(config.mongodb.uri);
            } catch (dbError) {
              logger.error("Failed to reconnect to database:", dbError);
            }
          }
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
        runOnInit: false,
      }
    );

    logger.info(`Cron job initialized with schedule: ${schedule}`);
    return scheduledJob;
  } catch (error) {
    logger.error("Failed to initialize cron job:", error);
    throw error;
  }
};

const stopCronJob = () => {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    logger.info("Cron job stopped");
  } else {
    logger.warn("No active cron job to stop");
  }
};

const runInitialPipeline = () => {
  runDataPipeline().catch((error) => {
    logger.error("Initial pipeline execution failed:", error);
  });
};

module.exports = {
  runDataPipeline,
  initCronJob,
  stopCronJob,
  sendDiscordNotification,
};
