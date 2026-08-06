// Cotizaciones en vivo — fuente única para todo lo que necesite convertir
// entre ARS/USD/USDT con la tasa real de mercado.
//
// Antes esto vivía únicamente adentro de rates.controller.js, y
// pos.controller.js no lo usaba en absoluto: recibía un `exchangeRate` del
// frontend y lo aplicaba tanto a USD como a USDT (dólar blue para las dos).
// Ahora rates.controller.js (GET /api/rates, para mostrar la cotización en
// el POS) y pos.controller.js (createSale, para calcular el precio real de
// la venta) llaman a este mismo módulo — una sola fuente de verdad para la
// tasa, el backend nunca confía en un `exchangeRate` mandado por el front
// para el cálculo final.
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Caché en memoria, 5 minutos — mismo comportamiento que tenía
// rates.controller.js antes de este refactor.
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

const fetchLiveRates = async () => {
  if (cache && Date.now() - cacheTime < TTL) return cache;

  const [blueResult, usdtResult] = await Promise.allSettled([
    fetchJSON('https://api.bluelytics.com.ar/v2/latest'),
    fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=USDTARS'),
  ]);

  if (blueResult.status === 'rejected') {
    console.error('[rates] blue fetch failed:', blueResult.reason?.message);
  }
  if (usdtResult.status === 'rejected') {
    console.error('[rates] usdt fetch failed:', usdtResult.reason?.message);
  }

  const blue =
    blueResult.status === 'fulfilled'
      ? { buy: blueResult.value?.blue?.value_buy ?? null, sell: blueResult.value?.blue?.value_sell ?? null }
      : { buy: null, sell: null };

  const usdt =
    usdtResult.status === 'fulfilled'
      ? { price: parseFloat(usdtResult.value?.price ?? 0) || null }
      : { price: null };

  cache = { blue, usdt, updatedAt: new Date().toISOString() };
  cacheTime = Date.now();
  return cache;
};

/**
 * Cotizaciones en vivo, con fallback a caché stale si el fetch falla.
 * Lanza si nunca hubo caché y el fetch también falla — el caller decide
 * qué responder en ese caso (503 en rates.controller.js, 422/500 en
 * pos.controller.js según si bloquea o no la operación).
 */
const getLiveRatesSafe = async () => {
  try {
    return await fetchLiveRates();
  } catch (error) {
    console.error('[rates] fetchLiveRates failed:', error.message);
    if (cache) return { ...cache, stale: true };
    throw error;
  }
};

/**
 * 1 unidad de `from` = ? unidades de `to`, usando cotizaciones reales de
 * mercado. ARS↔USD usa el dólar blue (venta); ARS↔USDT usa la cotización
 * real de Binance (USDT/ARS) — nunca la de blue para USDT. USD↔USDT se
 * cruza a través de ARS. Devuelve null si falta algún dato necesario.
 */
const resolveRate = (liveRates, from, to) => {
  if (from === to) return 1;
  const arsPerUnit = {
    USD:  liveRates?.blue?.sell ?? null,
    USDT: liveRates?.usdt?.price ?? null,
  };
  if (from === 'ARS') {
    const arsPerTo = arsPerUnit[to];
    return arsPerTo ? 1 / arsPerTo : null;
  }
  if (to === 'ARS') {
    return arsPerUnit[from] ?? null;
  }
  const arsPerFrom = arsPerUnit[from];
  const arsPerTo   = arsPerUnit[to];
  return (arsPerFrom && arsPerTo) ? arsPerFrom / arsPerTo : null;
};

/**
 * Persiste (o actualiza) la tasa de referencia del día para un par de
 * monedas — activa la tabla ExchangeRate, que hasta ahora quedaba
 * completamente vacía porque nada la escribía. Idempotente: una fila por
 * par de monedas por día (@@unique del schema).
 */
const getOrCreateDailyRate = async (fromCurrencyCode, toCurrencyCode, rate, source) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.exchangeRate.upsert({
    where: {
      fromCurrencyCode_toCurrencyCode_validDate: { fromCurrencyCode, toCurrencyCode, validDate: today },
    },
    update: { rate, source, fetchedAt: new Date() },
    create: { fromCurrencyCode, toCurrencyCode, validDate: today, rate, source },
  });
};

module.exports = { getLiveRatesSafe, resolveRate, getOrCreateDailyRate };
