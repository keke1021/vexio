// La lógica de fetch/caché/conversión vive en src/services/exchangeRates.service.js
// — este controller quedó como un wrapper delgado del servicio, compartido
// ahora con pos.controller.js (mismo motivo: no duplicar la obtención de la
// cotización en dos lugares).
const { getLiveRatesSafe } = require('../services/exchangeRates.service');

/**
 * GET /api/rates
 * Cotización dólar blue (bluelytics) y USDT (Binance). Cacheada 5 minutos.
 */
const getRates = async (req, res) => {
  try {
    const rates = await getLiveRatesSafe();
    res.json(rates);
  } catch (error) {
    console.error('[rates:getRates]', error);
    res.status(503).json({ message: 'No se pudo obtener el tipo de cambio.' });
  }
};

module.exports = { getRates };
