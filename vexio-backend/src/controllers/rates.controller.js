const https = require('https');

// In-memory cache — shared across requests, lasts 5 minutes
let cache = null;
let cacheTime = 0;
const TTL = 5 * 60 * 1000;

const fetchJSON = (url, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':      'Vexio/1.0',
          'Accept':          'application/json',
          'Accept-Encoding': 'identity',
        },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectCount < 3) {
          res.resume();
          return fetchJSON(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Invalid JSON from ${url}: ${data.slice(0, 120)}`)); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    req.on('error', reject);
  });

/**
 * GET /api/rates
 * Cotización dólar blue (bluelytics) y USDT (Binance).
 * Resultado cacheado 5 minutos en memoria.
 */
const getRates = async (req, res) => {
  try {
    if (cache && Date.now() - cacheTime < TTL) {
      return res.json(cache);
    }

    const [blueResult, usdtResult] = await Promise.allSettled([
      fetchJSON('https://api.bluelytics.com.ar/v2/latest'),
      fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=USDTARS'),
    ]);

    if (blueResult.status === 'rejected') {
      console.error('[rates] blue fetch failed:', blueResult.reason?.message);
    } else {
      console.log('[rates] blue raw:', JSON.stringify(blueResult.value).slice(0, 200));
    }

    if (usdtResult.status === 'rejected') {
      console.error('[rates] usdt fetch failed:', usdtResult.reason?.message);
    } else {
      console.log('[rates] usdt raw:', JSON.stringify(usdtResult.value).slice(0, 200));
    }

    const blue =
      blueResult.status === 'fulfilled'
        ? {
            buy:  blueResult.value?.blue?.value_buy  ?? null,
            sell: blueResult.value?.blue?.value_sell ?? null,
          }
        : { buy: null, sell: null };

    const usdt =
      usdtResult.status === 'fulfilled'
        ? { price: parseFloat(usdtResult.value?.price ?? 0) || null }
        : { price: null };

    cache = { blue, usdt, updatedAt: new Date().toISOString() };
    cacheTime = Date.now();

    res.json(cache);
  } catch (error) {
    console.error('[rates:getRates]', error);
    // Return stale cache if available, otherwise 503
    if (cache) return res.json({ ...cache, stale: true });
    res.status(503).json({ message: 'No se pudo obtener el tipo de cambio.' });
  }
};

module.exports = { getRates };
