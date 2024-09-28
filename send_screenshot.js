const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// Ortam değişkenlerinden Telegram bilgilerini al
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Ekran görüntüsü alınacak URL'ler
const URLS = [
  'https://sosovalue.com/assets/etf/Total_Crypto_Spot_ETF_Fund_Flow?page=usBTC',
  'https://sosovalue.com/assets/etf/Total_Crypto_Spot_ETF_Fund_Flow?page=usETH'
];

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

// Mesaj içeriği
const MESSAGE = `📅 Ekran görüntüleri alındı: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`;

(async () => {
  try {
    // Puppeteer ile tarayıcıyı başlat
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    
    // Tüm ekran görüntülerini saklamak için bir array
    const screenshots = [];

    for (const url of URLS) {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2' });

      // Dinamik dosya adı oluştur
      const formattedDateTime = getFormattedDateTime();
      const domain = new URL(url).searchParams.get('page'); // Sayfa parametresine göre isimlendirme
      const SCREENSHOT_PATH = `screenshot_${domain}_${formattedDateTime}.png`;

      // Ekran görüntüsünü al ve kaydet
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      screenshots.push(SCREENSHOT_PATH);
      await page.close();
    }

    await browser.close();

    // Telegram'a gönderilecek form data
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('caption', MESSAGE);

    // Her ekran görüntüsünü form data'ya ekle
    screenshots.forEach((screenshot) => {
      formData.append('photo', fs.createReadStream(screenshot));
    });

    // Ekran görüntülerini Telegram'a gönder
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data.ok) {
      console.log('Ekran görüntüleri başarıyla gönderildi:', screenshots);
    } else {
      console.error('Telegram API hatası:', response.data);
    }

    // Geçici dosyaları sil (isteğe bağlı)
    screenshots.forEach((screenshot) => {
      fs.unlinkSync(screenshot);
    });
  } catch (error) {
    console.error('Hata oluştu:', error);
  }
})();
