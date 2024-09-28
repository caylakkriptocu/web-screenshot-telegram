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
    url: 'https://sosovalue.com/assets/etf/Total_Crypto_Spot_ETF_Fund_Flow?page=usBTC',
    messageTemplate: 'BTC ETF ({{datetime}}) GİRİŞLERİ',
    identifier: 'usBTC',
    waitForSelector: '.btc-data-table' // BTC sayfasındaki önemli bir öğenin CSS seçici
  },
  {
    url: 'https://sosovalue.com/assets/etf/Total_Crypto_Spot_ETF_Fund_Flow?page=usETH',
    messageTemplate: 'ETHHETF ({{datetime}}) GİRİŞLERİ',
    identifier: 'usETH',
    waitForSelector: '.eth-data-table' // ETH sayfasındaki önemli bir öğenin CSS seçici
  }
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

// 10 saniye gecikme fonksiyonu
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  try {
    // Puppeteer ile tarayıcıyı başlat
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    for (const site of SITES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 }); // Viewport ayarları
      await page.goto(site.url, { waitUntil: 'networkidle2' });

      // Belirli bir öğeyi bekleme (varsa)
      if (site.waitForSelector) {
        try {
          await page.waitForSelector(site.waitForSelector, { timeout: 60000 });
        } catch (e) {
          console.error(`Belirtilen öğe bulunamadı: ${site.waitForSelector} için ${site.identifier}`);
          // Eğer öğe bulunamazsa, ekran görüntüsü almayı denemek yerine sonraki siteye geçebiliriz
          await page.close();
          continue;
        }
      } else {
        // Eğer belirli bir öğe yoksa, ek bir bekleme süresi ekleyin
        await page.waitForTimeout(5000); // 5 saniye bekleme
      }

      // Dinamik dosya adı oluştur
      const formattedDateTime = getFormattedDateTime();
      const SCREENSHOT_PATH = `screenshot_${site.identifier}_${formattedDateTime}.png`;

      // Ekran görüntüsünü al ve kaydet
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      await page.close();

      // Mesaj içeriğini oluştur
      const message = site.messageTemplate.replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }));

      // Telegram'a gönderilecek form data
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', fs.createReadStream(SCREENSHOT_PATH));
      formData.append('caption', message); // Mesajı ekle

      // Ekran görüntüsünü Telegram'a gönder
      const response = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
        formData,
        {
          headers: formData.getHeaders(),
        }
      );

      if (response.data.ok) {
        console.log(`Ekran görüntüsü başarıyla gönderildi: ${SCREENSHOT_PATH}`);
      } else {
        console.error('Telegram API hatası:', response.data);
      }

      // Geçici dosyayı sil (isteğe bağlı)
      fs.unlinkSync(SCREENSHOT_PATH);

      // 10 saniye gecikme
      await delay(10000); // 10000 milisaniye = 10 saniye
    }

    await browser.close();
  } catch (error) {
    console.error('Hata oluştu:', error);
  }
})();
