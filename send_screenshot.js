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

// Monitor etmek istediğimiz siteler
const SITES = [
  {
    url: 'https://coinmarketcap.com/etf/bitcoin/',
    messageTemplate: '<b>Bitcoin ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'btcETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text', // Net Flow'un bulunduğu span
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'      // Tarihin bulunduğu span
  },
  {
    url: 'https://coinmarketcap.com/etf/ethereum/',
    messageTemplate: '<b>Ethereum ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'ethETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text', // Net Flow'un bulunduğu span
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'      // Tarihin bulunduğu span
  }
];

// Tarih biçimlendirme (dosya ismi için)
function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-'); // 2025-02-14T14-05-00-000Z
}

// Bekleme fonksiyonu
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    // Puppeteer başlat
    browser = await puppeteer.launch({
      // Eğer istiyorsan otomatik kapatılmasın ve sayfayı gör:
      // headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const site of SITES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      try {
        // Sayfaya git
        await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (err) {
        console.error(`Failed to navigate to ${site.url}: ${err.message}`);
        await page.close();
        continue; // Sonraki siteye geç
      }

      // Tarih ve Net Flow değerlerini DOM'dan çek
      let extractedDate = 'Bilinmiyor';
      let netFlow = 'Bilinmiyor';

      try {
        // Tarih çek
        const dateElement = await page.$(site.dateSelector);
        if (dateElement) {
          extractedDate = await page.evaluate(el => el.textContent.trim(), dateElement);
          console.log(`Tarih bulundu: ${extractedDate}`);
        } else {
          console.warn('Tarih elementi bulunamadı.');
        }

        // Net Flow çek
        const netFlowElement = await page.$(site.netFlowSelector);
        if (netFlowElement) {
          netFlow = await page.evaluate(el => el.textContent.trim(), netFlowElement);
          console.log(`Net Flow bulundu: ${netFlow}`);
        } else {
          console.warn('Net Flow elementi bulunamadı.');
        }
      } catch (e) {
        console.error(`Bilgileri çekerken hata oluştu: ${e.message}`);
      }

      // Ekran görüntüsü dosya adı oluştur
      const formattedDateTime = getFormattedDateTime();
      const SCREENSHOT_PATH = `screenshot_${site.identifier}_${formattedDateTime}.png`;

      // Ekran görüntüsü al
      try {
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
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
          console.error(`Telegram API Hatası:`, response.data);
        }
      } catch (err) {
        console.error(`Telegram'a gönderim hatası: ${err.message}`);
      }

      // Ekran görüntüsü dosyasını sil
      try {
        await fs.unlink(SCREENSHOT_PATH);
        console.log(`Screenshot dosyası silindi: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Screenshot silme hatası: ${err.message}`);
      }

      // Sonraki siteye geçmeden önce kısa bir bekleme (opsiyonel)
      if (site !== SITES[SITES.length - 1]) {
        console.log('Bir sonraki siteye geçmeden 5 saniye bekleniyor...');
        await delay(5000);
      }
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
