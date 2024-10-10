const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;

// Retrieve Telegram credentials from environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Validate environment variables
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables.');
  process.exit(1);
}

// URLs to monitor and their configurations
const SITES = [
  {
    url: 'https://sosovalue.com/assets/etf/us-btc-spot',
    messageTemplate: '<b>BTC ETF</b> ({{datetime}})\nGÜNLÜK NET GİRİŞ: {{netFlow}}\n{{url}}',
    identifier: 'usBTC',
    netFlowXPath: '//div[contains(@class, "text-[20px] font-bold flex items-center text-status-down")]'
  },
  {
    url: 'https://sosovalue.com/assets/etf/us-eth-spot',
    messageTemplate: '<b>ETH ETF</b> ({{datetime}})\nGÜNLÜK NET GİRİŞ: {{netFlow}}\n{{url}}',
    identifier: 'usETH',
    netFlowXPath: '//div[contains(@class, "text-[20px] font-bold flex items-center text-status-down")]'
  }
];

// Generate a formatted date-time string
function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-'); // e.g., 2023-04-05T14-30-00-000Z
}

// Delay function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    // Launch Puppeteer browser once
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // headless: true, // Ensure headless is true for production
    });

    for (const site of SITES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      try {
        await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (err) {
        console.error(`Failed to navigate to ${site.url}: ${err.message}`);
        await page.close();
        continue; // Skip to the next site
      }

      // Extract the GÜNLÜK NET GİRİŞ value
      let netFlow;
      try {
        const [element] = await page.$x(site.netFlowXPath);
        if (element) {
          netFlow = await page.evaluate(el => el.textContent, element);
          console.log(`Net Flow found for ${site.identifier}: ${netFlow}`);
        } else {
          console.error(`Net Flow element not found for ${site.identifier}`);
          netFlow = 'Bilinmiyor';
        }
      } catch (e) {
        console.error(`Failed to extract net flow for ${site.identifier}: ${e.message}`);
        netFlow = 'Bilinmiyor';
      }

      await page.close();

      // Prepare the message
      const message = site.messageTemplate
        .replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
        .replace('{{netFlow}}', netFlow)
        .replace('{{url}}', site.url);

      // Send the message to Telegram
      try {
        const response = await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
          }
        );

        if (response.data.ok) {
          console.log(`Message sent to Telegram for ${site.identifier}`);
        } else {
          console.error(`Telegram API error for ${site.identifier}:`, response.data);
        }
      } catch (err) {
        console.error(`Failed to send message to Telegram for ${site.identifier}: ${err.message}`);
      }

      // Delay before processing the next site
      if (site !== SITES[SITES.length - 1]) {
        console.log('Waiting for 10 seconds before processing the next site...');
        await delay(10000);
      }
    }
  } catch (err) {
    console.error(`Unexpected error: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('Browser closed. Script finished.');
  }
})();
