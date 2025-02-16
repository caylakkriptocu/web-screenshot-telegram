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

// Para birimini USD'ye ayarlamak için gerekli adımlar
async function setCurrencyToUSD(page) {
  try {
    // 1) Kullanıcı menüsünü açmak için bekle ve tıkla
    //    class: .BasePopover_base__T5yOf.popover-base (menünün göründüğü sarmalayıcı)
    //    Bu selector değişirse güncelleyebilirsiniz.
    await page.waitForSelector('.BasePopover_base__T5yOf.popover-base', { timeout: 10000 });
    await page.click('.BasePopover_base__T5yOf.popover-base');
    console.log('Menü açıldı.');

    // 2) "Para Birimi" seçeneğini bul ve tıkla
    //    .UserDropdownItem_user-dropdown-item__SyxAi içinde "Para Birimi" yazısını arıyoruz.
    await page.waitForSelector('.UserDropdownItem_user-dropdown-item__SyxAi', { timeout: 10000 });
    await page.evaluate(() => {
      const items = document.querySelectorAll('.UserDropdownItem_user-dropdown-item__SyxAi');
      for (const item of items) {
        if (item.innerText.includes('Para Birimi')) {
          item.click();
          break;
        }
      }
    });
    console.log('"Para Birimi" menüsü tıklandı.');

    // 3) Açılan modalda "United States Dollar" seçeneğini tıkla
    //    class: .IntlConfigModal_item-name__kvwL9 => "United States Dollar" içeren span
    await page.waitForSelector('.IntlConfigModal_item-name__kvwL9', { timeout: 10000 });
    await page.evaluate(() => {
      const items = document.querySelectorAll('.IntlConfigModal_item-name__kvwL9');
      for (const item of items) {
        if (item.innerText.includes('United States Dollar')) {
          item.click();
          break;
        }
      }
    });
    console.log('Para birimi "USD" seçildi.');

    // Seçim tamamlandıktan sonra kısa bir bekleme
    await page.waitForTimeout(3000);

  } catch (error) {
    console.warn('Para birimi USD olarak ayarlanırken hata oluştu:', error.message);
  }
}

// İstediğiniz sayfalar (TR sürüm, para birimi menüsünü manuel seçtikten sonra ziyaret edeceğiz)
const SITES = [
  {
    url: 'https://coinmarketcap.com/tr/etf/bitcoin/',
    messageTemplate: '<b>Bitcoin ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'btcETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text', // Net Flow
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'      // Tarih
  },
  {
    url: 'https://coinmarketcap.com/tr/etf/ethereum/',
    messageTemplate: '<b>Ethereum ETF</b> ({{date}}) <b>\nGÜNLÜK NET GİRİŞ:</b> {{netFlow}}',
    identifier: 'ethETF',
    netFlowSelector: 'span.sc-65e7f566-0.eSPIPM.base-text', // Net Flow
    dateSelector: 'span.sc-65e7f566-0.kxhcgF.base-text'      // Tarih
  }
];

function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-'); // Örn: 2025-02-14T14-05-00-000Z
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false, // Menüyü görüp manuel kontrol istersen false
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // 1) TR ana sayfasına gidip para birimini USD yap
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // CoinMarketCap Türkçe ana sayfasına git
    console.log('Ana sayfaya gidiliyor...');
    await page.goto('https://coinmarketcap.com/tr/', { waitUntil: 'networkidle2', timeout: 60000 });

    // Para birimini USD'ye çevir
    await setCurrencyToUSD(page);

    // Artık SITES listesini gezerek veri çek
    for (const site of SITES) {
      const sitePage = await browser.newPage();
      await sitePage.setViewport({ width: 1280, height: 800 });

      try {
        console.log(`Navigating to ${site.url}`);
        await sitePage.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (err) {
        console.error(`Failed to navigate to ${site.url}: ${err.message}`);
        await sitePage.close();
        continue; // Sonrakiye geç
      }

      // Tarih ve NetFlow çek
      let extractedDate = 'Bilinmiyor';
      let netFlow = 'Bilinmiyor';

      try {
        // Tarihi al
        const dateElement = await sitePage.$(site.dateSelector);
        if (dateElement) {
          extractedDate = await sitePage.evaluate(el => el.textContent.trim(), dateElement);
          console.log(`Tarih bulundu: ${extractedDate}`);
        }

        // Net Flow'u al
        const netFlowElement = await sitePage.$(site.netFlowSelector);
        if (netFlowElement) {
          netFlow = await sitePage.evaluate(el => el.textContent.trim(), netFlowElement);
          console.log(`Net Flow bulundu: ${netFlow}`);
        }
      } catch (e) {
        console.error(`Bilgi çekme hatası: ${e.message}`);
      }

      // Ekran görüntüsü
      const screenshotPath = `screenshot_${site.identifier}_${getFormattedDateTime()}.png`;
      try {
        await sitePage.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`Screenshot alındı: ${screenshotPath}`);
      } catch (err) {
        console.error(`Screenshot alma hatası: ${err.message}`);
        await sitePage.close();
        continue;
      }

      await sitePage.close();

      // Telegram mesajı
      const message = site.messageTemplate
        .replace('{{date}}', extractedDate)
        .replace('{{netFlow}}', netFlow);

      // Telegram'a gönder
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', await fs.readFile(screenshotPath), screenshotPath);
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
          console.log(`Telegram'a gönderildi: ${screenshotPath}`);
        } else {
          console.error(`Telegram API Hatası:`, response.data);
        }
      } catch (err) {
        console.error(`Telegram'a gönderim hatası: ${err.message}`);
      }

      // Lokal dosyayı sil
      try {
        await fs.unlink(screenshotPath);
        console.log(`Screenshot silindi: ${screenshotPath}`);
      } catch (err) {
        console.error(`Dosya silme hatası: ${err.message}`);
      }

      console.log('Bir sonraki siteye geçmeden 2 saniye bekleniyor...\n');
      await delay(2000);
    }

    // Sayfaları kapat
    await page.close();

  } catch (err) {
    console.error(`Beklenmeyen hata: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('Tarayıcı kapatıldı. Script tamamlandı.');
  }
})();
