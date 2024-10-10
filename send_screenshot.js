const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// Ortam değişkenlerinden Telegram bilgilerini al
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Ekran görüntüsü alınacak URL'ler ve mesaj şablonları
const SITES = [
  {
    url: 'https://sosovalue.com/assets/etf/us-btc-spot',
    messageTemplate: '<b>BTC ETF</b> ({{datetime}})\n<strong>Günlük Net Giriş:</strong> {{description}}',
    identifier: 'usBTC'
  },
  {
    url: 'https://sosovalue.com/assets/etf/us-eth-spot',
    messageTemplate: '<b>ETH ETF</b> ({{datetime}})\n<strong>Günlük Net Giriş:</strong> {{description}}',
    identifier: 'usETH'
  }
];

// Tarih ve saat bilgisi ekleyerek dinamik dosya adı oluşturma fonksiyonu
function getFormattedDateTime() {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

// 10 saniye gecikme fonksiyonu
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let overallMessage = '';  // Tüm sayfalar için net giriş verilerini toplamak için
  for (const site of SITES) {
    let browser;
    try {
      // Yeni bir tarayıcı başlat
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(site.url, { waitUntil: 'networkidle2' });

      // Tüm sayfanın ekran görüntüsünü al
      const formattedDateTime = getFormattedDateTime();
      const screenshotPath = `screenshot_${site.identifier}_${formattedDateTime}.png`;
      
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Sayfanın tamamının ekran görüntüsü alındı: ${screenshotPath}`);

      // Her site için mesajı biriktir
      const message = site.messageTemplate
        .replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
        .replace('{{description}}', 'Sayfa ekran görüntüsü alındı.');
      
      overallMessage += message + '\n\n';  // Tüm sayfalar için mesajları biriktir

      // Telegram'a gönderilecek form data
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', fs.createReadStream(screenshotPath));
      formData.append('caption', message);
      formData.append('parse_mode', 'HTML');

      // Ekran görüntüsünü Telegram'a gönder
      const response = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
        formData,
        {
          headers: formData.getHeaders(),
        }
      );

      if (response.data.ok) {
        console.log(`Ekran görüntüsü başarıyla gönderildi: ${screenshotPath}`);
      } else {
        console.error('Telegram API hatası:', response.data);
      }

      // Geçici dosyayı sil (isteğe bağlı)
      fs.unlinkSync(screenshotPath);

    } catch (error) {
      console.error(`Hata oluştu: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    if (site !== SITES[SITES.length - 1]) {
      await delay(10000);  // İki site arasında 10 saniye bekle
    }
  }

  // Tüm sayfalar için toplanan mesajı Telegram'a gönder
  if (overallMessage) {
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('text', overallMessage);
    formData.append('parse_mode', 'HTML');

    // Mesajı Telegram'a gönder
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data.ok) {
      console.log('Günlük net giriş mesajı başarıyla gönderildi.');
    } else {
      console.error('Telegram API hatası:', response.data);
    }
  }
})();
