const express = require('express');
const cors = require('cors');
const path = require('path');
const corsAnywhere = require('cors-anywhere');
const puppeteer = require('puppeteer');

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

// ٢. API ی ڕۆبۆتەکە (وەشانی زیرەکتر)
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
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-web-security', // ڕێگەدان بە پشکنینی سێرڤەری دەرەکی (iframes)
                '--disable-features=IsolateOrigins,site-per-process' // زۆر گرنگە بۆ بینینی ڤیدیۆی ناو iframe
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // شاردنەوەی ڕۆبۆتەکە بۆ ئەوەی سایتەکان بلۆکی نەکەن
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        let foundVideoUrl = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const reqUrl = request.url();
            const resourceType = request.resourceType();

            // بلۆککردنی وێنە و ستایلەکان بۆ ئەوەی پڕۆسەکە زۆر خێرا بێت
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType) && !reqUrl.includes('.m3u8') && !reqUrl.includes('.mp4')) {
                request.abort();
                return;
            }

            // گەڕان بۆ بەستەری ڤیدیۆ (زۆرتر کراوە بۆ جۆرەکانی تر)
            if ((reqUrl.includes('.m3u8') || reqUrl.includes('.mp4') || reqUrl.includes('.webm')) && !foundVideoUrl) {
                // دڵنیابوونەوە لەوەی لینکی ڕیکلام نییە
                if (!reqUrl.includes('adserver') && !reqUrl.includes('tracking')) {
                    console.log(`✅ ڤیدیۆکە دۆزرایەوە: ${reqUrl}`);
                    foundVideoUrl = reqUrl;
                }
            }
            request.continue();
        });

        // چوونە ناو سایتەکە
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        
        // چاوەڕێکردن بۆ لۆدبوونی جاڤاسکریپتی سایتەکە
        await new Promise(resolve => setTimeout(resolve, 4000));

        // ئەگەر ڤیدیۆکە خۆکارانە نەدۆزرایەوە، ڕۆبۆتەکە "کلیک" دەکات
        if (!foundVideoUrl) {
            console.log('👆 ڤیدیۆ نەدۆزرایەوە... هەوڵدانی کلیک کردن لە ناوەڕاستی شاشە بۆ کارپێکردنی ڤیدیۆ (Click to Play)');
            try {
                // کلیک کردن لە چەقی شاشەکە (زۆربەی کات پلەیەرەکان لەوێن)
                await page.mouse.click(960, 540);
                await new Promise(resolve => setTimeout(resolve, 6000)); // چاوەڕێکردنی نێتۆرک دوای کلیکەکە
            } catch (e) {
                console.log('کێشە لە کلیک کردن ڕوویدا');
            }
        }

        // پشکنینی دووەم: گەڕان بەناو تاگەکانی HTML دا ئەگەر هێشتا نەیدۆزیبوویەوە
        if (!foundVideoUrl) {
            console.log('گەڕان بەناو کۆدی HTML و iframe دا...');
            foundVideoUrl = await page.evaluate(() => {
                const videoTag = document.querySelector('video src, video source');
                if (videoTag && videoTag.src && (videoTag.src.includes('.mp4') || videoTag.src.includes('.m3u8'))) {
                    return videoTag.src;
                }
                return null;
            });
        }

        if (foundVideoUrl) {
            res.json({ success: true, videoUrl: foundVideoUrl });
        } else {
            res.json({ success: false, error: 'هیچ بەستەرێکی ڤیدیۆ نەدۆزرایەوە. ڕەنگە ڤیدیۆکە زۆر بەهێز پارێزراو بێت یان پێویستی بە تێپەڕاندنی کەپچا هەبێت.' });
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
