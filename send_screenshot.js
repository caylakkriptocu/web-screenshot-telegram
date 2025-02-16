const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

// Çevresel değişkenlerden Token ve Chat ID okunuyor
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Örnek site listesi
const SITES = [
  {
    url: 'https://coinmarketcap.com/etf/bitcoin/',
    messageTemplate: '<b>Bitcoin ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'btcETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text',
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'
  },
  {
    url: 'https://coinmarketcap.com/etf/ethereum/',
    messageTemplate: '<b>Ethereum ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'ethETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text',
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'
  }
];

function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // headless: false, // Ekranı görmek istersen false yap
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
        continue; // Bir sonraki siteye geç
      }

      // Gerekli bilgileri DOM'dan çek
      let extractedDate = 'Bilinmiyor';
      let netFlow = 'Bilinmiyor';

      try {
        const dateElement = await page.$(site.dateSelector);
        if (dateElement) {
          extractedDate = await page.evaluate(el => el.textContent.trim(), dateElement);
        } else {
          console.warn('Tarih elementi bulunamadı.');
        }

        const netFlowElement = await page.$(site.netFlowSelector);
        if (netFlowElement) {
          netFlow = await page.evaluate(el => el.textContent.trim(), netFlowElement);
        } else {
          console.warn('Net Flow elementi bulunamadı.');
        }
      } catch (e) {
        console.error(`Elementlerden bilgi çekilirken hata: ${e.message}`);
      }

      // Ekran görüntüsü adı
      const formattedDateTime = getFormattedDateTime();
      const SCREENSHOT_PATH = `screenshot_${site.identifier}_${formattedDateTime}.png`;

      try {
        // Sadece görünürdeki kısmı çekmek için fullPage: false
        await page.screenshot({
          path: SCREENSHOT_PATH,
          fullPage: false 
        });
        console.log(`Screenshot alındı: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Screenshot alma hatası: ${err.message}`);
        await page.close();
        continue;
      }

      await page.close();

      // Mesaj hazırlama
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
          console.log(`Screenshot Telegram'a gönderildi: ${SCREENSHOT_PATH}`);
        } else {
          console.error(`Telegram API hatası:`, response.data);
        }
      } catch (err) {
        console.error(`Telegram'a gönderim hatası: ${err.message}`);
      }

      // Dosya sil
      try {
        await fs.unlink(SCREENSHOT_PATH);
        console.log(`Screenshot silindi: ${SCREENSHOT_PATH}`);
      } catch (err) {
        console.error(`Dosya silme hatası: ${err.message}`);
      }

      // Bir sonraki siteye geçmeden önce kısa bekleme
      // await delay(5000);
    }
  } catch (err) {
    console.error(`Beklenmeyen hata: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('Tarayıcı kapatıldı. İşlem bitti.');
  }
})();
