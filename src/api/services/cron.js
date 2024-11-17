const cron = require('node-cron');
const config = require('../../config');
const TwitterService = require('./twitter');
const GeminiService = require('./gemini');
const Tweet = require('../models/tweet');
const GithubService = require('./github');
const nodemailer = require('nodemailer'); // Add Nodemailer
const winston = require('winston'); // Add Winston for logging

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'cron-job' },
  transports: [
    new winston.transports.File({ filename: 'cron-job.log', level: 'info' }),
  ],
});


const runDataPipeline = async () => {
  const { keywords, hashtags } = config;
  const timestamp = new Date().toISOString();

  try {
    logger.info(`Starting data pipeline at ${timestamp}`);

    // 1. Fetch Tweets
    const tweets = await TwitterService.fetchTweets(keywords, hashtags);
    logger.info(`Fetched ${tweets.length} tweets`);

    // 2. Process Tweets with Gemini
    const processedTweets = await GeminiService.generateMarkdown(tweets);
    logger.info(`Processed ${processedTweets.length} tweets with Gemini`);

    // 3. Store Tweets in MongoDB
    await Tweet.insertMany(processedTweets);
    logger.info(`Saved ${processedTweets.length} tweets to MongoDB`);

    // 4. Upload Markdown to GitHub
    const markdownContent = processedTweets.map(tweet => tweet.markdown).join('\n');
    const fileBuffer = Buffer.from(markdownContent);
    const uploadResult = await GithubService.uploadMarkdownFile(fileBuffer, config.github.repo, config.github.folder);
    logger.info(`Uploaded Markdown to GitHub: ${uploadResult.message}`);


    // 5. Email Notifications (Optional)
    if (config.email.user && config.email.pass) {
      const transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: false, // true for 465, false for other ports
        auth: {
          user: config.email.user,
          pass: config.email.pass,
        },
      });

      const mailOptions = {
        from: config.email.user,
        to: config.email.user,
        subject: 'Twitter to GitHub Pipeline Status',
        text: uploadResult.success ? 'Pipeline completed successfully!' : 'Pipeline encountered errors.',
      };

      try {
        await transporter.sendMail(mailOptions);
        logger.info('Sent email notification');
      } catch (emailError) {
        logger.error('Failed to send email notification:', emailError);
      }
    }

    logger.info(`Data pipeline completed successfully at ${new Date().toISOString()}`);
  } catch (error) {
    logger.error(`Data pipeline failed at ${new Date().toISOString()}:`, error);
  }
};

cron.schedule(config.cron.schedule, runDataPipeline);

logger.info(`Cron job scheduled to run at ${config.cron.schedule}`);

```