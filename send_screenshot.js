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
    messageTemplate: '<b>BTC ETF</b> ({{datetime}})\n{{url}}\n<strong>Günlük Net Giriş:</strong> {{description}}',
    identifier: 'usBTC',
    // Sayfanın tamamen yüklendiğini doğrulamak için önemli bir öğenin XPath'i
    waitForXPath: '//span[contains(text(), "Total Bitcoin Spot ETF Net Inflow")]',
    // Metni almak istediğiniz öğenin XPath'i
    textXPath: '//span[contains(@class, "text-base") and contains(@class, "font-bold") and contains(@class, "text-neutral-fg-2-rest")]'
  },
  {
    url: 'https://sosovalue.com/assets/etf/Total_Crypto_Spot_ETF_Fund_Flow?page=usETH',
    messageTemplate: '<b>ETH ETF</b> ({{datetime}})\n{{url}}\n<strong>Günlük Net Giriş:</strong> {{description}}',
    identifier: 'usETH',
    // Sayfanın tamamen yüklendiğini doğrulamak için önemli bir öğenin XPath'i
    waitForXPath: '//span[contains(text(), "Total Ethereum Spot ETF Net Inflow")]',
    // Metni almak istediğiniz öğenin XPath'i
    textXPath: '//span[contains(@class, "text-base") and contains(@class, "font-bold") and contains(@class, "text-neutral-fg-2-rest")]'
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
  for (const site of SITES) {
    let browser;
    try {
      // Yeni bir tarayıcı başlat
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        // headless: false, // Geliştirme sırasında sayfanın nasıl render edildiğini görmek için devre dışı bırakabilirsiniz
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 }); // Viewport ayarları

      await page.goto(site.url, { waitUntil: 'networkidle2' });

      // Belirli bir öğeyi bekleme (XPath kullanarak)
      if (site.waitForXPath) {
        try {
          await page.waitForXPath(site.waitForXPath, { timeout: 60000 }); // 60 saniye timeout
          console.log(`Belirtilen öğe bulundu: ${site.identifier}`);
        } catch (e) {
          console.error(`Belirtilen öğe bulunamadı: ${site.waitForXPath} için ${site.identifier}`);
          // Öğeyi bulamasa bile ekran görüntüsünü almaya devam ediyoruz
        }
      } else {
        // Eğer belirli bir öğe yoksa, ek bir bekleme süresi ekleyin
        await page.waitForTimeout(5000); // 5 saniye bekleme
      }

      // Belirli bir öğenin metnini al
      let description = 'Metin alınamadı.';
      if (site.textXPath) {
        try {
          const [element] = await page.$x(site.textXPath);
          if (element) {
            // Öğenin metnini al
            description = await page.evaluate(el => el.textContent, element);
            description = description.trim();
            console.log(`Açıklama metni alındı: ${description}`);
          }
        } catch (e) {
          console.error(`Açıklama metni alınamadı: ${e.message}`);
        }
      }

      // Dinamik dosya adı oluştur
      const formattedDateTime = getFormattedDateTime();
      const SCREENSHOT_PATH = `screenshot_${site.identifier}_${formattedDateTime}.png`;

      // Ekran görüntüsünü al ve kaydet
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      await page.close();

      // Mesaj içeriğini oluştur
      const message = site.messageTemplate
        .replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
        .replace('{{url}}', site.url)
        .replace('{{description}}', description);

      // Telegram'a gönderilecek form data
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', fs.createReadStream(SCREENSHOT_PATH));
      formData.append('caption', message); // Mesajı ekle
      formData.append('parse_mode', 'HTML'); // HTML formatında mesaj göndermek için

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
    } catch (error) {
      console.error(`Hata oluştu: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    // 10 saniye gecikme (son site değilse)
    if (site !== SITES[SITES.length - 1]) {
      await delay(10000); // 10000 milisaniye = 10 saniye
    }
  }
})();
