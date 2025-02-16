const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables.');
  process.exit(1);
}

const SITES = [
  {
    url: 'https://sosovalue.com/assets/etf/us-btc-spot',
    messageTemplate: '<b>BTC ETF</b> ({{datetime}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'usBTC',
    netFlowXPath: '//div[contains(@class, "text-[20px] font-bold flex items-center text-status")]'
  },
  {
    url: 'https://sosovalue.com/assets/etf/us-eth-spot',
    messageTemplate: '<b>ETH ETF</b> ({{datetime}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'usETH',
    netFlowXPath: '//div[contains(@class, "text-[20px] font-bold flex items-center text-status")]'
  }
];

function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false, // Eğer manuel doğrulama gerekirse headless:false kullan
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const site of SITES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      try {
        await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (err) {
        console.error(`Failed to navigate to ${site.url}: ${err.message}`);
        await page.close();
        continue;
      }

      // **Cloudflare doğrulama kutusunu bul ve tıkla**
      try {
        const [captcha] = await page.$x('//input[@type="checkbox"]');
        if (captcha) {
          await captcha.click();
          console.log('Cloudflare doğrulaması başlatıldı...');
          await delay(5000); // Doğrulamanın tamamlanması için bekle
        } else {
          console.log('Cloudflare doğrulaması gerekmiyor.');
        }
      } catch (e) {
        console.error('Cloudflare doğrulama sürecinde hata oluştu:', e.message);
      }

      // **GÜNLÜK NET GİRİŞ değerini çek**
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

      const formattedDateTime = getFormattedDateTime();
      const SCREENSHOT_PATH = `screenshot_${site.identifier}_${formattedDateTime}.png`;

      try {
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
        console.log(`Screenshot taken: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Failed to take screenshot for ${site.identifier}: ${err.message}`);
        await page.close();
        continue;
      }

      await page.close();

      const message = site.messageTemplate
        .replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
        .replace('{{netFlow}}', netFlow);

      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', await fs.readFile(SCREENSHOT_PATH), SCREENSHOT_PATH);
      formData.append('caption', message);
      formData.append('parse_mode', 'HTML');

      try {
        const response = await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
          formData,
          {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );

        if (response.data.ok) {
          console.log(`Screenshot sent to Telegram: ${SCREENSHOT_PATH}`);
        } else {
          console.error(`Telegram API error for ${site.identifier}:`, response.data);
        }
      } catch (err) {
        console.error(`Failed to send screenshot to Telegram for ${site.identifier}: ${err.message}`);
      }

      try {
        await fs.unlink(SCREENSHOT_PATH);
        console.log(`Deleted screenshot file: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Failed to delete screenshot file ${SCREENSHOT_PATH}: ${err.message}`);
      }

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
