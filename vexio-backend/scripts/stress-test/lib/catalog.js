// Catálogo de productos y helpers de precio — mismo criterio de variedad que
// seed-demo.js (varios modelos/colores/storages, ciclo de moneda fijo,
// ventana de precio según condición) para que el inventario de este tenant
// de prueba se vea igual de real que el de demo.

const PRODUCTS = [
  { name: 'iPhone 11', color: 'Negro', storage: '64GB' },
  { name: 'iPhone 11', color: 'Blanco', storage: '128GB' },
  { name: 'iPhone 11 Pro', color: 'Gris Espacial', storage: '64GB' },
  { name: 'iPhone 12', color: 'Azul', storage: '64GB' },
  { name: 'iPhone 12', color: 'Blanco', storage: '128GB' },
  { name: 'iPhone 12', color: 'Negro', storage: '128GB' },
  { name: 'iPhone 12 Pro', color: 'Grafito', storage: '128GB' },
  { name: 'iPhone 12 Pro', color: 'Oro', storage: '256GB' },
  { name: 'iPhone 13', color: 'Medianoche', storage: '128GB' },
  { name: 'iPhone 13', color: 'Rosa', storage: '128GB' },
  { name: 'iPhone 13', color: 'Celeste', storage: '256GB' },
  { name: 'iPhone 13 Pro', color: 'Alpino', storage: '256GB' },
  { name: 'iPhone 13 Pro Max', color: 'Grafito', storage: '256GB' },
  { name: 'iPhone 14', color: 'Medianoche', storage: '128GB' },
  { name: 'iPhone 14', color: 'Púrpura', storage: '256GB' },
  { name: 'iPhone 14', color: 'Azul', storage: '128GB' },
  { name: 'iPhone 14 Pro', color: 'Morado Oscuro', storage: '128GB' },
  { name: 'iPhone 14 Pro', color: 'Espacial Negro', storage: '256GB' },
  { name: 'iPhone 14 Pro Max', color: 'Dorado', storage: '256GB' },
  { name: 'iPhone 14 Pro Max', color: 'Plata', storage: '512GB' },
];

const CURRENCY_CYCLE = ['ARS', 'USD', 'USDT', 'ARS', 'USD', 'ARS', 'USDT', 'USD'];

const PRICE_RANGES = {
  ARS: { min: 700000, max: 1500000 },
  USD: { min: 500, max: 1700 },
  USDT: { min: 500, max: 1700 },
};

const CONDITION_WINDOW = {
  NEW: [0.65, 1.0],
  LIKE_NEW: [0.55, 0.85],
  REFURBISHED: [0.4, 0.7],
  USED: [0.3, 0.6],
};
const CONDITION_WEIGHTS = [['NEW', 35], ['LIKE_NEW', 30], ['REFURBISHED', 20], ['USED', 15]];

const currencyForProductIdx = (idx) => CURRENCY_CYCLE[idx % CURRENCY_CYCLE.length];

const priceForCurrency = (rng, currencyCode, condition) => {
  const { min, max } = PRICE_RANGES[currencyCode];
  const [lo, hi] = CONDITION_WINDOW[condition];
  const price = min + rng.randFloat(lo, hi) * (max - min);
  return parseFloat(price.toFixed(2));
};

module.exports = { PRODUCTS, CURRENCY_CYCLE, CONDITION_WEIGHTS, currencyForProductIdx, priceForCurrency };
