const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables.');
  process.exit(1);
}

const SITE_URL = 'https://sosovalue.com/assets/etf/us-btc-spot';
const SCREENSHOT_PATH = 'screenshot.png';

// Cloudflare doğrulamasını geçme fonksiyonu
async function bypassCloudflare(page) {
  try {
    console.log('Cloudflare doğrulaması bekleniyor...');
    await page.waitForSelector('input[type="checkbox"]', { timeout: 10000 });

    const checkbox = await page.$('input[type="checkbox"]');
    if (checkbox) {
      await checkbox.click();
      console.log('Cloudflare doğrulama kutusu tıklandı.');
      await page.waitForTimeout(5000);
    }

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    console.warn('Cloudflare doğrulama sürecinde hata:', e.message);
  }
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(SITE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    await bypassCloudflare(page);

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`Screenshot saved: ${SCREENSHOT_PATH}`);

    await browser.close();

    // Telegram'a mesaj gönderme
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', await fs.readFile(SCREENSHOT_PATH), SCREENSHOT_PATH);
    formData.append('caption', 'Günlük ETF Ekran Görüntüsü');
    formData.append('parse_mode', 'HTML');

    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      formData,
      { headers: formData.getHeaders() }
    );

    // ✅ **Telegram API Yanıtını Logla!**
    console.log('📩 Telegram API Yanıtı:', response.data);

    if (response.data.ok) {
      console.log('✅ Screenshot Telegram’a gönderildi.');
    } else {
      console.error('❌ Telegram API Hatası:', response.data);
    }

    await fs.unlink(SCREENSHOT_PATH);
    console.log('🗑 Screenshot dosyası silindi.');
  } catch (err) {
    console.error(`🚨 Beklenmeyen hata: ${err.message}`);
  }
})();
