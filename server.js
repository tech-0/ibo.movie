const express = require('express');
const cors = require('cors');
const path = require('path');
const corsAnywhere = require('cors-anywhere');

// زیادکردنی تایبەتمەندی Stealth بۆ تێپەڕاندنی Cloudflare و دژە-ڕۆبۆتەکانی سایتە کوردییەکان
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ١. پرۆکسی بۆ ڤیدیۆکان
const proxy = corsAnywhere.createServer({
    originWhitelist: [], 
    requireHeader: [],
    removeHeaders: ['cookie', 'cookie2'],
    setHeaders: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
});

app.use('/proxy/', (req, res) => {
    req.url = req.url.replace('/proxy/', '/');
    try {
        const targetUrl = new URL(req.url.substring(1));
        req.headers['referer'] = targetUrl.origin + '/';
        req.headers['origin'] = targetUrl.origin;
    } catch (e) {}
    proxy.emit('request', req, res);
});

// ٢. API ی ڕۆبۆتەکە بۆ سایتە قورسەکان
app.post('/api/extract-video', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'تکایە بەستەرێک بنێرە' });

    console.log(`🔍 ڕۆبۆت خەریکی پشکنینی ئەم لینکەیە: ${url}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1920,1080'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        let foundVideoUrl = null;

        // چاودێریکردنی نێتۆرک بۆ دۆزینەوەی .m3u8
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const reqUrl = request.url();
            const resourceType = request.resourceType();

            // ڕێگریکردن لە لۆدبوونی وێنە و فۆنت بۆ خێرایی، بەڵام ڕێگە بە iframe دەدەین
            if (['image', 'font', 'stylesheet'].includes(resourceType)) {
                request.abort();
                return;
            }

            // ئەگەر لینکی ڤیدیۆ بوو
            const isVideo = reqUrl.includes('.m3u8') || reqUrl.includes('.mp4') || reqUrl.includes('playlist.m3u8') || reqUrl.includes('index.m3u8');
            const isAd = reqUrl.includes('adserver') || reqUrl.includes('tracking');

            if (isVideo && !isAd && !foundVideoUrl) {
                console.log(`✅ ڤیدیۆکە دۆزرایەوە: ${reqUrl}`);
                foundVideoUrl = reqUrl;
            }
            
            request.continue();
        });

        console.log('چوونە ناو سایت...');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 4000)); // چاوەڕێکردن بۆ لۆدبوونی سایتەکە

        // ئەگەر لە پەڕەی سەرەکی نەبوو، دەگەڕێین بەدوای iframe دا (تایبەت بە KurdFilm, KurdSubtitle, هتد)
        if (!foundVideoUrl) {
            console.log('گەڕان بەدوای ئایفرەیم (iframe) ی شاراوەدا...');
            
            // هێنانە دەرەوەی هەموو ئایفرەیمەکانی ناو سایتەکە
            const iframes = await page.$$('iframe');
            
            for (let iframe of iframes) {
                if (foundVideoUrl) break;
                
                try {
                    const src = await page.evaluate(el => el.src, iframe);
                    console.log('ئایفرەیمێک دۆزرایەوە بە لینکی:', src);
                    
                    // گەڕان بۆ سێرڤەرە ناسراوەکانی ڤیدیۆ
                    if (src && (src.includes('vidmoly') || src.includes('ok.ru') || src.includes('uqload') || src.includes('embed') || src.includes('player') || src.includes('vimeo'))) {
                        console.log('ئایفرەیمەکە هی ڤیدیۆیە، ڕۆبۆت دەچێتە ناویەوە...');
                        // ڕۆبۆتەکە دەچێتە ناو ئەو لینکەوە بۆ ئەوەی ڤیدیۆکە لۆد بکات
                        await page.goto(src, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await new Promise(resolve => setTimeout(resolve, 4000));
                        
                        // کلیک کردن لە چەقی ڤیدیۆکە بۆ کارپێکردنی
                        await page.mouse.click(960, 540);
                        await new Promise(resolve => setTimeout(resolve, 4000));
                    }
                } catch (e) {
                    console.log('نەتوانرا ئایفرەیمەکە بخوێنرێتەوە');
                }
            }
        }

        // کۆتا هەوڵ: کلیک کردن لە چەقی پەڕەکە ئەگەر هیچ ئایفرەیمێکیش نەبوو
        if (!foundVideoUrl) {
            console.log('هەوڵی کۆتایی... کلیک کردن لە شاشەکە');
            await page.mouse.click(960, 540);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        if (foundVideoUrl) {
            res.json({ success: true, videoUrl: foundVideoUrl });
        } else {
            res.json({ success: false, error: 'هیچ بەستەرێکی ڤیدیۆ نەدۆزرایەوە. پاراستنی سایتەکە زۆر بەهێزە.' });
        }

    } catch (error) {
        console.error('هەڵە لە ڕۆبۆتدا:', error.message);
        res.status(500).json({ success: false, error: 'نەتوانرا پەڕەکە بکرێتەوە: ' + error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(port, () => {
    console.log(`🎬 سێرڤەری سینەما کارایە لەسەر پۆڕتی ${port}`);
});
