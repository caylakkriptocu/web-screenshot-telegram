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

// **Cloudflare doğrulamasını geçme fonksiyonu**
async function bypassCloudflare(page) {
  try {
    console.log('✅ Cloudflare doğrulama sayfası bekleniyor...');
    
    // **Cloudflare doğrulama kutusu çıkarsa tıkla**
    await page.waitForSelector('input[type="checkbox"]', { timeout: 15000 });
    const checkbox = await page.$('input[type="checkbox"]');

    if (checkbox) {
      await checkbox.click();
      console.log('☑️ Cloudflare doğrulama kutusu tıklandı.');
    }

    // **Sayfanın tam yüklendiğini bekle**
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('✅ Cloudflare doğrulaması geçildi.');

  } catch (e) {
    console.warn('⚠️ Cloudflare doğrulama sürecinde hata:', e.message);
  }
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,  // **Eğer manuel CAPTCHA çıkarsa elle çözebilmen için headless:false**
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(SITE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // **Cloudflare doğrulamasını geç**
    await bypassCloudflare(page);

    // **Sayfa yüklendikten sonra ekran görüntüsü al**
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`📸 Screenshot kaydedildi: ${SCREENSHOT_PATH}`);

    await browser.close();

    // **Telegram’a mesaj gönderme**
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', await fs.readFile(SCREENSHOT_PATH), SCREENSHOT_PATH);
    formData.append('caption', '📊 Günlük ETF Ekran Görüntüsü');
    formData.append('parse_mode', 'HTML');

    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      formData,
      { headers: formData.getHeaders() }
    );

    // **Telegram API yanıtını logla**
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
