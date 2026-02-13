const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const config = require("./config");
const { logger, sleep } = require("./src/utils/helpers");

class ListValidator {
  constructor() {
    this.driver = null;
    this.isInitialized = false;
  }

  async init() {
    try {
      let options = new chrome.Options();
      options.options_["debuggerAddress"] = "127.0.0.1:9222";

      this.driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();

      logger.info("Connected to existing Chrome browser");
      this.isInitialized = true;
    } catch (connectionError) {
      logger.error(
        "Failed to connect to Chrome. Make sure Chrome is running with: chrome --remote-debugging-port=9222",
      );
      throw new Error(
        "Chrome not running with remote debugging. Run: chrome --remote-debugging-port=9222",
      );
    }
  }

  async validateList(listId, retryCount = 0) {
    const maxRetries = 2;
    let originalWindow = null;
    let newTab = null;

    try {
      // Get current window handle
      originalWindow = await this.driver.getWindowHandle();

      // Open new tab
      await this.driver.switchTo().newWindow("tab");
      newTab = await this.driver.getWindowHandle();

      const listUrl = `https://x.com/i/lists/${listId}`;
      await this.driver.get(listUrl);
      await sleep(5000); // Longer wait for page load

      // Check if we're redirected or see an error
      const currentUrl = await this.driver.getCurrentUrl();

      // Check for explicit error messages first
      try {
        const errorElement = await this.driver.findElement(
          By.xpath(
            "//*[contains(text(), \"doesn't exist\") or contains(text(), 'not found') or contains(text(), 'Something went wrong')]",
          ),
        );
        if (errorElement) {
          await this.driver.close();
          await this.driver.switchTo().window(originalWindow);
          return {
            valid: false,
            reason: "Page not found or error message displayed",
          };
        }
      } catch (e) {
        // No error message found, continue checking
      }

      // Check if URL changed (redirect to error page)
      if (!currentUrl.includes(listId)) {
        await this.driver.close();
        await this.driver.switchTo().window(originalWindow);
        return { valid: false, reason: "Redirected away from list page" };
      }

      // Check for rate limit indicators
      const pageSource = await this.driver.getPageSource();
      const isBlankPage = pageSource.length < 5000; // Very small page = likely blank

      // Try to find tweet elements or empty state
      try {
        await this.driver.wait(
          until.elementLocated(
            By.css(
              '[data-testid="cellInnerDiv"], [data-testid="emptyState"], [data-testid="primaryColumn"]',
            ),
          ),
          15000,
        );

        // Additional check: make sure we have actual content, not just loading spinner
        await sleep(2000);
        const hasContent = await this.driver.findElements(
          By.css('[data-testid="cellInnerDiv"], [data-testid="emptyState"]'),
        );

        await this.driver.close();
        await this.driver.switchTo().window(originalWindow);

        if (hasContent.length > 0) {
          return { valid: true, reason: "List page loaded successfully" };
        } else if (isBlankPage && retryCount < maxRetries) {
          logger.warn(
            `    ⚠️ Blank page detected, retrying (${retryCount + 1}/${maxRetries})...`,
          );
          await sleep(10000); // Wait longer before retry
          return this.validateList(listId, retryCount + 1);
        } else {
          return {
            valid: false,
            reason:
              "Could not find list content (possible rate limit or invalid list)",
          };
        }
      } catch (e) {
        await this.driver.close();
        await this.driver.switchTo().window(originalWindow);

        // If blank page and we have retries left, try again
        if (isBlankPage && retryCount < maxRetries) {
          logger.warn(
            `    ⚠️ Timeout with blank page, retrying (${retryCount + 1}/${maxRetries})...`,
          );
          await sleep(10000); // Wait 10 seconds before retry
          return this.validateList(listId, retryCount + 1);
        }

        return {
          valid: false,
          reason: `Could not find list content or empty state (timeout after ${retryCount + 1} attempts)`,
        };
      }
    } catch (error) {
      // Clean up tab if it exists
      try {
        if (newTab) {
          await this.driver.close();
        }
        if (originalWindow) {
          await this.driver.switchTo().window(originalWindow);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      return { valid: false, reason: `Error: ${error.message}` };
    }
  }

  async validateAllLists() {
    const results = {
      valid: [],
      invalid: [],
      summary: {},
    };

    logger.info("Starting list validation...\n");

    for (const folder of config.folders) {
      logger.info(`\nValidating folder: ${folder.name}`);
      logger.info(`Lists to check: ${folder.lists.length}`);

      for (const listId of folder.lists) {
        logger.info(`  Checking list ID: ${listId}...`);
        const result = await this.validateList(listId);

        const listInfo = {
          listId,
          folderName: folder.name,
          ...result,
        };

        if (result.valid) {
          results.valid.push(listInfo);
          logger.info(`    ✅ VALID - ${result.reason}`);
        } else {
          results.invalid.push(listInfo);
          logger.error(`    ❌ INVALID - ${result.reason}`);
        }

        // Longer delay between checks to avoid rate limiting
        await sleep(5000);
      }
    }

    // Generate summary
    results.summary = {
      totalLists: results.valid.length + results.invalid.length,
      validCount: results.valid.length,
      invalidCount: results.invalid.length,
      validPercentage: (
        (results.valid.length /
          (results.valid.length + results.invalid.length)) *
        100
      ).toFixed(2),
    };

    return results;
  }

  async cleanup() {
    try {
      if (this.driver) {
        await this.driver.quit();
      }
    } catch (error) {
      logger.error("Failed to clean up:", error);
    }
  }
}

async function main() {
  const validator = new ListValidator();

  try {
    await validator.init();
    const results = await validator.validateAllLists();

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("VALIDATION SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Lists: ${results.summary.totalLists}`);
    console.log(
      `Valid: ${results.summary.validCount} (${results.summary.validPercentage}%)`,
    );
    console.log(`Invalid: ${results.summary.invalidCount}`);
    console.log("=".repeat(60));

    if (results.invalid.length > 0) {
      console.log("\n❌ INVALID LISTS:");
      console.log("=".repeat(60));
      results.invalid.forEach((item) => {
        console.log(`Folder: ${item.folderName}`);
        console.log(`List ID: ${item.listId}`);
        console.log(`Reason: ${item.reason}`);
        console.log("-".repeat(60));
      });
    }

    if (results.valid.length > 0) {
      console.log("\n✅ VALID LISTS:");
      console.log("=".repeat(60));
      results.valid.forEach((item) => {
        console.log(`Folder: ${item.folderName} | List ID: ${item.listId}`);
      });
    }

    // Save results to file
    const fs = require("fs");
    fs.writeFileSync(
      "list-validation-results.json",
      JSON.stringify(results, null, 2),
    );
    console.log("\n📄 Full results saved to: list-validation-results.json");
  } catch (error) {
    logger.error("Fatal error:", error);
  } finally {
    await validator.cleanup();
  }
}

main();
