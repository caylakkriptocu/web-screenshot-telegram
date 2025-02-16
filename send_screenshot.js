const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

// Çevresel değişkenlerden Token ve Chat ID okunuyor
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables.');
  process.exit(1);
}

// Takip edilecek sayfalar
const SITES = [
  {
    url: 'https://coinmarketcap.com/tr/etf/bitcoin/?convert=USD',
    messageTemplate: '<b>Bitcoin ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'btcETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text',
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'
  },
  {
    url: 'https://coinmarketcap.com/tr/etf/ethereum/?convert=USD',
    messageTemplate: '<b>Ethereum ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'ethETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text',
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'
  }
];

// Tarih formatlama (dosya ismi için)
function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-'); // 2025-02-14T14-05-00-000Z
}

// Küçük bekleme fonksiyonu
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    // Puppeteer başlat
    browser = await puppeteer.launch({
      // Eğer görsel olarak ekranda görmek istersen headless: false yap
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Sırasıyla her sayfayı işle
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
        continue;
      }

      // DOM'dan tarih ve net flow değerlerini çek
      let extractedDate = 'Bilinmiyor';
      let netFlow = 'Bilinmiyor';

      try {
        // Tarihi al
        const dateElement = await page.$(site.dateSelector);
        if (dateElement) {
          extractedDate = await page.evaluate(el => el.textContent.trim(), dateElement);
          console.log(`Tarih: ${extractedDate}`);
        } else {
          console.warn('Tarih elementi bulunamadı.');
        }

        // Net Flow'u al
        const netFlowElement = await page.$(site.netFlowSelector);
        if (netFlowElement) {
          netFlow = await page.evaluate(el => el.textContent.trim(), netFlowElement);
          console.log(`Net Flow: ${netFlow}`);
        } else {
          console.warn('Net Flow elementi bulunamadı.');
        }
      } catch (e) {
        console.error(`Bilgi çekme hatası: ${e.message}`);
      }

      // Ekran görüntüsü ismi
      const formattedDateTime = getFormattedDateTime();
      const SCREENSHOT_PATH = `screenshot_${site.identifier}_${formattedDateTime}.png`;

      // Sadece ekranda görünen alanı çek
      try {
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
        console.log(`Screenshot alındı: ${SCREENSHOT_PATH}`);
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

      // Telegram'a gönderim
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', await fs.readFile(SCREENSHOT_PATH), SCREENSHOT_PATH);
      formData.append('caption', message);
      formData.append('parse_mode', 'HTML');

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
          console.log(`Telegram'a gönderildi: ${SCREENSHOT_PATH}`);
        } else {
          console.error('Telegram API hatası:', response.data);
        }
      } catch (err) {
        console.error(`Telegram'a gönderim hatası: ${err.message}`);
      }

      // Lokal ekran görüntüsü dosyasını sil
      try {
        await fs.unlink(SCREENSHOT_PATH);
        console.log(`Screenshot silindi: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Silme hatası: ${err.message}`);
      }

      // Bir sonraki siteye geçmeden önce biraz bekleme
      console.log('Bir sonraki siteye geçmeden 3 saniye bekliyoruz...\n');
      await delay(3000);
    }
  } catch (err) {
    console.error(`Beklenmeyen hata: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('Tarayıcı kapatıldı. Script bitti.');
  }
})();
