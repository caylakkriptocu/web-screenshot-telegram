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
    waitForXPath: '//span[@class="text-neutral-fg-2-rest text-sm font-bold mr-1" and contains(text(), "Total Bitcoin Spot ETF Net Inflow")]',
    boundingBoxSelector: 'div.px-3.flex.flex-col.relative.col-span-full.xl\\:col-span-1.h-block',
    textXPath: '//span[@class="text-base font-bold text-neutral-fg-2-rest" and contains(text(), "-$18.66M")]' // Net Inflow text
  },
  {
    url: 'https://sosovalue.com/assets/etf/us-eth-spot',
    messageTemplate: '<b>ETH ETF</b> ({{datetime}})\n<strong>Günlük Net Giriş:</strong> {{description}}',
    identifier: 'usETH',
    waitForXPath: '//span[@class="text-neutral-fg-2-rest text-sm font-bold mr-1" and contains(text(), "Total Ethereum Spot ETF Net Inflow")]',
    boundingBoxSelector: 'div.px-3.flex.flex-col.relative.col-span-full.xl\\:col-span-1.h-block',
    textXPath: '//span[@class="text-base font-bold text-neutral-fg-2-rest" and contains(text(), "-$8.19M")]' // Net Inflow text
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

      // Belirli bir öğeyi bekleme
      if (site.waitForXPath) {
        try {
          await page.waitForXPath(site.waitForXPath, { timeout: 60000 });
          console.log(`Belirtilen öğe bulundu: ${site.identifier}`);
        } catch (e) {
          console.error(`Belirtilen öğe bulunamadı: ${site.waitForXPath} için ${site.identifier}`);
        }
      } else {
        await page.waitForTimeout(5000);
      }

      // Belirli bir öğenin metnini al
      let description = 'Metin alınamadı.';
      if (site.textXPath) {
        try {
          const [element] = await page.$x(site.textXPath);
          if (element) {
            description = await page.evaluate(el => el.textContent, element);
            description = description.trim();
            console.log(`Açıklama metni alındı: ${description}`);
          }
        } catch (e) {
          console.error(`Açıklama metni alınamadı veya öğe bulunamadı: ${e.message}`);
        }
      }

      // Sadece belirlenen alanın ekran görüntüsünü al
      const boundingBoxElement = await page.$(site.boundingBoxSelector);
      if (boundingBoxElement) {
        const boundingBox = await boundingBoxElement.boundingBox();
        const formattedDateTime = getFormattedDateTime();
        const screenshotPath = `partial_screenshot_${site.identifier}_${formattedDateTime}.png`;

        await page.screenshot({ 
          path: screenshotPath, 
          clip: boundingBox 
        });

        console.log(`Belirlenen alanın ekran görüntüsü alındı: ${screenshotPath}`);

        // Her site için mesajı biriktir
        const message = site.messageTemplate
          .replace('{{datetime}}', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
          .replace('{{description}}', description);
        
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
      }

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
