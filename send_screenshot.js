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

// 1) Para birimini USD'ye çevirmek için menü tıklama fonksiyonu
async function setCurrencyToUSD(page) {
  try {
    console.log('Para birimi menüsü açılıyor...');
    // **Menü ikonu** (avatar / dropdown açan buton) için kullandığınız class
    // Örneğin: ".BasePopover_base__T5yOf.popover-base"
    // Mevcut coinmarketcap TR ana sayfasında kullanıcı menüsü ikonunu bekleyelim.
    await page.waitForSelector('.BasePopover_base__T5yOf.popover-base', { timeout: 15000 });
    await page.click('.BasePopover_base__T5yOf.popover-base');
    console.log('Menü açıldı.');

    // "Para Birimi" yazan seçeneği tıkla
    // .UserDropdownItem_user-dropdown-item__SyxAi içinde "Para Birimi" metnini arıyoruz
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

    // Açılan modalda "United States Dollar" seç
    // .IntlConfigModal_item-name__kvwL9 => "United States Dollar"
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

    // Seçim sonrası ufak bir bekleme
    await page.waitForTimeout(3000);

  } catch (error) {
    console.warn('Para birimi USD olarak ayarlanırken hata oluştu:', error.message);
  }
}

// 2) Çekeceğimiz sayfalar
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

// Dosya ismi için tarih
function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-'); 
}

// Ufak bekletme
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    // **HEADLESS: true** => X server gerektirmeden çalışır
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    // 1) Ana sayfa açılır, USD'ye geçilir
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Ana sayfaya gidiliyor...');
    await page.goto('https://coinmarketcap.com/tr/', { waitUntil: 'networkidle2', timeout: 60000 });

    // Para birimini USD'ye ayarla
    await setCurrencyToUSD(page);

    // 2) Ardından ETF sayfalarını ziyaret et
    for (const site of SITES) {
      const sitePage = await browser.newPage();
      await sitePage.setViewport({ width: 1280, height: 800 });

      try {
        console.log(`Navigating to: ${site.url}`);
        await sitePage.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (err) {
        console.error(`Failed to navigate: ${site.url}, hata: ${err.message}`);
        await sitePage.close();
        continue;
      }

      let extractedDate = 'Bilinmiyor';
      let netFlow = 'Bilinmiyor';

      // Verileri çek
      try {
        const dateEl = await sitePage.$(site.dateSelector);
        if (dateEl) {
          extractedDate = await sitePage.evaluate(el => el.textContent.trim(), dateEl);
          console.log(`Tarih: ${extractedDate}`);
        }
        const netFlowEl = await sitePage.$(site.netFlowSelector);
        if (netFlowEl) {
          netFlow = await sitePage.evaluate(el => el.textContent.trim(), netFlowEl);
          console.log(`Net Flow: ${netFlow}`);
        }
      } catch (err) {
        console.error(`Bilgi çekme hatası: ${err.message}`);
      }

      // Ekran görüntüsü
      const screenshotPath = `screenshot_${site.identifier}_${getFormattedDateTime()}.png`;
      try {
        // Görünen alan (fullPage: false)
        await sitePage.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`Screenshot kaydedildi: ${screenshotPath}`);
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

      // Fotoğrafı form-data'ya ekle
      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('photo', await fs.readFile(screenshotPath), screenshotPath);
      formData.append('caption', message);
      formData.append('parse_mode', 'HTML');

      try {
        const response = await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
          formData,
          { headers: formData.getHeaders() }
        );
        if (response.data.ok) {
          console.log(`Telegram'a gönderildi: ${screenshotPath}`);
        } else {
          console.error(`Telegram API Hatası:`, response.data);
        }
      } catch (err) {
        console.error(`Telegram'a gönderim hatası: ${err.message}`);
      }

      // Dosyayı sil
      try {
        await fs.unlink(screenshotPath);
        console.log(`Screenshot silindi: ${screenshotPath}`);
      } catch (err) {
        console.error(`Dosya silme hatası: ${err.message}`);
      }

      console.log('Bir sonraki siteye geçmeden 2 saniye bekleniyor...\n');
      await delay(2000);
    }

    // Ana sayfayı kapat
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
