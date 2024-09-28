const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const URL = 'https://sosovalue.com/assets/etf/Total_Crypto_Spot_ETF_Fund_Flow?page=usBTC';
const SCREENSHOT_PATH = 'screenshot.png';

(async () => {
  try {
    // Puppeteer ile tarayıcıyı başlat
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2' });

    // Ekran görüntüsünü al
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    await browser.close();

    // Ekran görüntüsünü Telegram'a gönder
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', fs.createReadStream(SCREENSHOT_PATH));

    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data.ok) {
      console.log('Ekran görüntüsü başarıyla gönderildi.');
    } else {
      console.error('Telegram API hatası:', response.data);
    }

    // Geçici dosyayı sil
    fs.unlinkSync(SCREENSHOT_PATH);
  } catch (error) {
    console.error('Hata oluştu:', error);
  }
})();
 
