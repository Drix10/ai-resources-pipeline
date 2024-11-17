const { logger, sleep } = require("./helpers");

class RateLimiter {
  constructor({ maxRequests, timeWindow, retryAfter }) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.retryAfter = retryAfter;
    this.requests = [];
  }

  async checkLimit() {
    const now = Date.now();

    this.requests = this.requests.filter(
      (time) => now - time < this.timeWindow
    );

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const timeToWait = Math.max(
        this.timeWindow - (now - oldestRequest),
        this.retryAfter
      );

      logger.warn(
        `Rate limit reached. Waiting ${timeToWait}ms before next request`
      );
      await sleep(timeToWait);
      this.requests = [];
    }

    this.requests.push(now);
    return true;
  }
}

module.exports = { RateLimiter };
