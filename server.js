const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const path = require('path');
const corsAnywhere = require('cors-anywhere');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ١. سیستەمی پرۆکسی بۆ لێدانی ڤیدیۆکان و ساختەکردنی Referer
const proxy = corsAnywhere.createServer({
    originWhitelist: [], 
    requireHeader: [],
    removeHeaders: ['cookie', 'cookie2'],
    setHeaders: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
});

app.use('/proxy/', (req, res) => {
    req.url = req.url.replace('/proxy/', '/');
    
    // لێرەدا هێدەرەکان ساختە دەکەین بۆ ئەوەی سایتەکە وا بزانێت لەناو خۆیەوە ڤیدیۆکە دەکرێتەوە!
    try {
        const targetUrl = new URL(req.url.substring(1));
        req.headers['referer'] = targetUrl.origin + '/';
        req.headers['origin'] = targetUrl.origin;
    } catch (e) {}
    
    proxy.emit('request', req, res);
});

// ٢. API ی ڕۆبۆتەکە (Puppeteer)
app.post('/api/extract-video', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'تکایە بەستەرێک بنێرە' });

    console.log(`🔍 خەریکی پشکنینی ئەم لینکەم: ${url}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        let foundVideoUrl = null;

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const reqUrl = request.url();
            // دۆزینەوەی بەستەری فیلم
            if ((reqUrl.includes('.m3u8') || reqUrl.includes('.mp4')) && !foundVideoUrl) {
                console.log(`✅ ڤیدیۆکە دۆزرایەوە: ${reqUrl}`);
                foundVideoUrl = reqUrl;
            }
            request.continue();
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 8000)); // چاوەڕێکردنی لۆدبوون

        if (foundVideoUrl) {
            res.json({ success: true, videoUrl: foundVideoUrl });
        } else {
            res.json({ success: false, error: 'هیچ بەستەرێکی ڤیدیۆ نەدۆزرایەوە لەم پەڕەیەدا.' });
        }

    } catch (error) {
        console.error('هەڵە ڕوویدا:', error);
        res.status(500).json({ success: false, error: 'نەتوانرا پەڕەکە بکرێتەوە.' });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(port, () => {
    console.log(`🎬 سێرڤەری سینەما کارایە لەسەر پۆڕتی ${port}`);
});