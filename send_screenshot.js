const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

// Stealth mod etkinleştir
puppeteer.use(StealthPlugin());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set.');
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

async function bypassCloudflare(page) {
  try {
    // Cloudflare "checkbox" kontrolü
    await page.waitForSelector('input[type="checkbox"]', { timeout: 15000 });
    const checkbox = await page.$('input[type="checkbox"]');
    if (checkbox) {
      await checkbox.click();
      console.log('Cloudflare checkbox tıklandı, bekleniyor...');
      await delay(5000);
    }
    // Turnstile/JS kontrolü varsa da bekle
  } catch (e) {
    console.log('Checkbox bulunamadı veya zaman aşımı:', e.message);
  }
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,  // Görsel CAPTCHA çıkarsa manuel geçmek için
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    // Gelişmiş bir User-Agent kullan
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
    );

    // Her site için sırayla işlemleri yap
    for (const site of SITES) {
      await page.setViewport({ width: 1280, height: 800 });
      try {
        console.log(`Navigating to ${site.url} ...`);
        await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
        // Cloudflare kontrolünü dene
        await bypassCloudflare(page);
      } catch (err) {
        console.error(`Sayfaya gidilemedi ${site.url}: ${err.message}`);
        continue;
      }

      // Manuel CAPTCHA geliyorsa headless:false ekranda görünecektir
      // Bu noktada elle çözmemiz gerekebilir!

      // netFlow değeri
      let netFlow = 'Bilinmiyor';
      try {
        const [element] = await page.$x(site.netFlowXPath);
        if (element) {
          netFlow = await page.evaluate(el => el.textContent, element);
          console.log(`Net Flow for ${site.identifier}: ${netFlow}`);
        } else {
          console.error(`Net Flow element not found for ${site.identifier}`);
        }
      } catch (err) {
        console.error(`Net flow çekilemedi: ${err.message}`);
      }

      // Ekran görüntüsü al
      const screenshotPath = `screenshot_${site.identifier}_${getFormattedDateTime()}.png`;
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot taken: ${screenshotPath}`);

        // Telegram'a gönder
        const message = site.messageTemplate
          .replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
          .replace('{{netFlow}}', netFlow);

        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('photo', await fs.readFile(screenshotPath), screenshotPath);
        formData.append('caption', message);
        formData.append('parse_mode', 'HTML');

        const response = await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
          formData,
          { headers: formData.getHeaders() }
        );

        console.log('Telegram yanıtı:', response.data);
        if (response.data.ok) {
          console.log(`Screenshot sent to Telegram: ${screenshotPath}`);
        } else {
          console.error(`Telegram API error:`, response.data);
        }

        // Ekran görüntüsünü sil
        await fs.unlink(screenshotPath);
      } catch (err) {
        console.error(`Screenshot/Telegram aşamasında hata: ${err.message}`);
      }

      // Bir sonraki siteye geçmeden önce ufak bir bekleme
      await delay(5000);
    }

    await browser.close();
  } catch (err) {
    console.error('Genel hata:', err.message);
    if (browser) {
      await browser.close();
    }
  }
})();
