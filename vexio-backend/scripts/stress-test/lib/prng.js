// Mismo PRNG que seed-demo.js (mulberry32) — se usa acá para el "plan" de
// cada día (montos, quién vende qué, qué día tiene actividad del dueño,
// etc.), NO para la concurrencia real de los requests (eso es async/HTTP de
// verdad, no determinístico y no tiene por qué serlo). Tener el plan
// generado con semilla fija hace que la corrida sea más fácil de inspeccionar
// y repetir en su forma, aunque los tiempos reales de red varíen.

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const rand = mulberry32(seed);
  const chance = (p) => rand() < p;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pickWeighted = (weighted) => {
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [value, w] of weighted) {
      if ((r -= w) <= 0) return value;
    }
    return weighted[weighted.length - 1][0];
  };
  const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
  const randFloat = (min, max) => rand() * (max - min) + min;
  return { rand, chance, pick, pickWeighted, randInt, randFloat };
}

module.exports = { makeRng };
