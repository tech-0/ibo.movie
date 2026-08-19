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

// ٢. API ی ڕۆبۆتەکە
app.post('/api/extract-video', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'تکایە بەستەرێک بنێرە' });

    console.log(`🔍 ڕۆبۆت خەریکی پشکنینی ئەم لینکەیە: ${url}`);
    
    let browser;
    try {
        // لێرەدا ڕێڕەوی چڕۆم بە شێوازی خودکار دەدۆزینەوە یان ڕێڕەوی توند دەنوسین
        browser = await puppeteer.launch({ 
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        let foundVideoUrl = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const reqUrl = request.url();
            if ((reqUrl.includes('.m3u8') || reqUrl.includes('.mp4')) && !foundVideoUrl) {
                console.log(`✅ ڤیدیۆکە دۆزرایەوە: ${reqUrl}`);
                foundVideoUrl = reqUrl;
            }
            request.continue();
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 8000));

        if (foundVideoUrl) {
            res.json({ success: true, videoUrl: foundVideoUrl });
        } else {
            res.json({ success: false, error: 'هیچ بەستەرێکی ڤیدیۆ نەدۆزرایەوە لەم پەڕەیەدا.' });
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
