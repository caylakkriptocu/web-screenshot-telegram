const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// Ortam değişkenlerinden Telegram bilgilerini al
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Ekran görüntüsü alınacak URL
const URL = 'https://sosovalue.com/assets/etf/Total_Crypto_Spot_ETF_Fund_Flow?page=usBTC';

// Tarih ve saat bilgisi ekleyerek dinamik dosya adı oluşturma fonksiyonu
function getFormattedDateTime() {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Aylar 0-11 arasıdır
  const day = String(date.getDate()).padStart(2, '0');
  
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

// Dinamik ekran görüntüsü dosya adı
const SCREENSHOT_PATH = `screenshot_${getFormattedDateTime()}.png`;

// Mesaj içeriği
const MESSAGE = `📅 Ekran görüntüsü alındı: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`;

(async () => {
  try {
    // Puppeteer ile tarayıcıyı başlat
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2' });

    // Ekran görüntüsünü al ve dinamik dosya adına kaydet
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    await browser.close();

    // Ekran görüntüsünü Telegram'a gönder
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', fs.createReadStream(SCREENSHOT_PATH));
    formData.append('caption', MESSAGE); // Mesajı ekle

    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data.ok) {
      console.log('Ekran görüntüsü başarıyla gönderildi:', SCREENSHOT_PATH);
    } else {
      console.error('Telegram API hatası:', response.data);
    }

    // Geçici dosyayı sil (isteğe bağlı)
    fs.unlinkSync(SCREENSHOT_PATH);
  } catch (error) {
    console.error('Hata oluştu:', error);
  }
})();
