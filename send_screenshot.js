const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

// Çevre değişkenlerinden Token ve Chat ID okunuyor
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables.');
  process.exit(1);
}

// İstediğimiz sayfalar
const SITES = [
  {
    url: 'https://coinmarketcap.com/tr/etf/bitcoin/?convert=USD',
    messageTemplate: '<b>Bitcoin ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'btcETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text', // Net Flow span
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'      // Tarih span
  },
  {
    url: 'https://coinmarketcap.com/tr/etf/ethereum/?convert=USD',
    messageTemplate: '<b>Ethereum ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'ethETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text',
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'
  }
];

// Tarihi dosya ismi için düzenliyoruz
function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-'); // Örn: 2025-02-16T06-01-09-000Z
}

// Ufak bekleme fonksiyonu
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    // **HEADLESS: true** burada önemli!
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    for (const site of SITES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      try {
        // Sayfaya git
        console.log(`Navigating to: ${site.url}`);
        await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (err) {
        console.error(`Failed to navigate to ${site.url}: ${err.message}`);
        await page.close();
        continue; // Bir sonraki siteye geç
      }

      let extractedDate = 'Bilinmiyor';
      let netFlow = 'Bilinmiyor';

      try {
        // Tarihi çek
        const dateElement = await page.$(site.dateSelector);
        if (dateElement) {
          extractedDate = await page.evaluate(el => el.textContent.trim(), dateElement);
          console.log(`Tarih: ${extractedDate}`);
        } else {
          console.warn('Tarih elementi bulunamadı!');
        }

        // Net Flow'u çek
        const netFlowElement = await page.$(site.netFlowSelector);
        if (netFlowElement) {
          netFlow = await page.evaluate(el => el.textContent.trim(), netFlowElement);
          console.log(`Net Flow: ${netFlow}`);
        } else {
          console.warn('Net Flow elementi bulunamadı!');
        }
      } catch (e) {
        console.error(`Bilgi çekme hatası: ${e.message}`);
      }

      // Ekran görüntüsü dosya ismi
      const formattedDateTime = getFormattedDateTime();
      const SCREENSHOT_PATH = `screenshot_${site.identifier}_${formattedDateTime}.png`;

      try {
        // Sadece görünen alanı çekmek için fullPage: false
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
        console.log(`Screenshot kaydedildi: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Screenshot alma hatası: ${err.message}`);
        await page.close();
        continue;
      }

      await page.close();

      // Telegram'a gönderilecek mesaj
      const message = site.messageTemplate
        .replace('{{date}}', extractedDate)
        .replace('{{netFlow}}', netFlow);

      // FormData ile fotoğrafı ekliyoruz
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', await fs.readFile(SCREENSHOT_PATH), SCREENSHOT_PATH);
      formData.append('caption', message);
      formData.append('parse_mode', 'HTML');

      // Telegram'a gönder
      try {
        const response = await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
          formData,
          {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );

        if (response.data.ok) {
          console.log(`Screenshot Telegram'a gönderildi: ${SCREENSHOT_PATH}`);
        } else {
          console.error('Telegram API Hatası:', response.data);
        }
      } catch (err) {
        console.error(`Telegram'a gönderim hatası: ${err.message}`);
      }

      // Lokal dosyayı sil
      try {
        await fs.unlink(SCREENSHOT_PATH);
        console.log(`Screenshot silindi: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Dosya silme hatası: ${err.message}`);
      }

      // Bir sonraki siteye geçmeden kısa bekleme
      console.log('Bir sonraki siteye geçmeden 3 saniye bekleniyor...\n');
      await delay(3000);
    }
  } catch (err) {
    console.error(`Beklenmeyen hata: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('Tarayıcı kapatıldı. Script tamamlandı.');
  }
})();
