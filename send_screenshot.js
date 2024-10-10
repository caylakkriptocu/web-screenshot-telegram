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
    identifier: 'usBTC',
    elementXPath: '//div[contains(@class, "px-3 flex flex-col relative col-span-full xl:col-span-1 h-block")]'
  },
  {
    url: 'https://sosovalue.com/assets/etf/us-eth-spot',
    messageTemplate: '<b>ETH ETF</b> ({{datetime}})\n<strong>Günlük Net Giriş:</strong> {{description}}',
    identifier: 'usETH',
    elementXPath: '//div[contains(@class, "px-3 flex flex-col relative col-span-full xl:col-span-1 h-block")]'
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

      // Belirli öğeyi XPath ile bulma ve ekran görüntüsü alma
      let elementScreenshotPath = '';
      try {
        const [element] = await page.$x(site.elementXPath);
        if (element) {
          const formattedDateTime = getFormattedDateTime();
          elementScreenshotPath = `element_screenshot_${site.identifier}_${formattedDateTime}.png`;

          // Sadece öğenin ekran görüntüsünü al
          await element.screenshot({ path: elementScreenshotPath });
          console.log(`Öğenin ekran görüntüsü alındı: ${elementScreenshotPath}`);
        }
      } catch (e) {
        console.error(`Öğe bulunamadı: ${e.message}`);
      }

      // Telegram'a gönderilecek form data
      if (elementScreenshotPath) {
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('photo', fs.createReadStream(elementScreenshotPath));
        formData.append('caption', site.messageTemplate
          .replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
        );
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
          console.log(`Ekran görüntüsü başarıyla gönderildi: ${elementScreenshotPath}`);
        } else {
          console.error('Telegram API hatası:', response.data);
        }

        // Geçici dosyayı sil (isteğe bağlı)
        fs.unlinkSync(elementScreenshotPath);
      }

    } catch (error) {
      console.error(`Hata oluştu: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    if (site !== SITES[SITES.length - 1]) {
      await delay(10000);
    }
  }
})();
