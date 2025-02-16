const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');

// Çevre değişkenlerden Token ve Chat ID al
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables.');
  process.exit(1);
}

// 1) Para birimini USD'ye çevirmek için menü tıklama fonksiyonu
async function setCurrencyToUSD(page) {
  try {
    // Menüde "TRY" yazan kısım: .GlobalFunction_currency-picker__n01zm
    // Bazen bu element gecikebilir, bekleme süresini artır
    console.log('Para birimi menüsü bekleniyor...');
    await page.waitForSelector('.GlobalFunction_currency-picker__n01zm', { timeout: 20000 });
    
    // Öncesinde debug screenshot alıp menünün görünüp görünmediğine bakabilirsin
    // await page.screenshot({ path: 'debug_before_click.png' });

    console.log('Para birimi menüsü tıklanıyor (TRY) ...');
    await page.click('.GlobalFunction_currency-picker__n01zm');

    // Şimdi açılan modalda "United States Dollar" seçeneğini bulalım
    // Bu class: .IntlConfigModal_item-name__kvwL9
    // Tek tek bakıp "United States Dollar" içereni tıklayacağız
    console.log('USD seçeneği bekleniyor...');
    await page.waitForSelector('.IntlConfigModal_item-name__kvwL9', { timeout: 20000 });

    // Tek tek öğeleri dolaş
    const usdClicked = await page.evaluate(() => {
      const items = document.querySelectorAll('.IntlConfigModal_item-name__kvwL9');
      for (const item of items) {
        if (item.innerText.includes('United States Dollar')) {
          item.click();
          return true; // Bulduk ve tıkladık
        }
      }
      return false; // Bulamadık
    });

    if (usdClicked) {
      console.log('Para birimi "USD" seçildi.');
      // Seçim sonrası ufak bir bekleme
      await page.waitForTimeout(3000);
    } else {
      console.warn('Menüde "United States Dollar" bulunamadı!');
    }

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

// Tarih format (dosya ismi için)
function getFormattedDateTime() {
  const date = new Date();
  return date.toISOString().replace(/[:.]/g, '-'); 
}

// Ufak bekleme
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  try {
    // Menü tıklamalarını görebilmek için headless: false
    // Headless: true olursa bazen elementler farklı davranabiliyor
    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    // 1) Ana sayfa aç
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Ana sayfaya gidiliyor (coinmarketcap.com/tr) ...');
    await page.goto('https://coinmarketcap.com/tr/', { waitUntil: 'networkidle2', timeout: 60000 });

    // 2) Para birimini USD yap
    await setCurrencyToUSD(page);

    // 3) ETF sayfaları
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

      // Gerekli verileri çek
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

      // Fotoğrafı form-data'ya ekleyip gönder
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
