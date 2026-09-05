// Cliente HTTP real contra el backend (fetch nativo de Node — no axios/
// node-fetch, no hace falta con Node 24). Cada "sesión" (SUPERADMIN, OWNER,
// cada empleado) es una instancia de Session con su propio access/refresh
// token, que se refresca sola cuando hace falta — la simulación puede correr
// horas reales aunque el access token dure 15 min.
//
// TODO lo que pasa por acá queda logueado en out/run-log-*.jsonl (una línea
// JSON por request) — es el insumo que usa audit.js (Fase 2) para poder
// decir "esto es lo que se disparó, esto es lo que respondió el server" de
// cada escenario de contención, no solo el estado final de la DB.

const fs = require('fs');
const config = require('../config');

let logStream = null;
function ensureLogStream() {
  if (!logStream) {
    fs.mkdirSync(config.OUT_DIR, { recursive: true });
    logStream = fs.createWriteStream(config.RUN_LOG_FILE, { flags: 'a' });
  }
  return logStream;
}

function logLine(entry) {
  ensureLogStream().write(JSON.stringify(entry) + '\n');
}

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 2 * 60 * 1000; // refresca 2 min antes de que venza

class Session {
  constructor(label) {
    this.label = label; // ej. "OWNER", "emp1", "SUPERADMIN"
    this.accessToken = null;
    this.refreshToken = null;
    this.issuedAt = 0;
    this.userId = null;
    this.role = null;
  }

  async login(email, password) {
    const res = await fetch(`${config.BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`[${this.label}] login falló (${res.status}): ${body.message || JSON.stringify(body)}`);
    }
    this.accessToken = body.accessToken;
    this.refreshToken = body.refreshToken;
    this.issuedAt = Date.now();
    this.userId = body.user?.id;
    this.role = body.user?.role;
    return body;
  }

  async ensureFreshToken() {
    if (!this.accessToken) throw new Error(`[${this.label}] sesión sin login.`);
    if (Date.now() - this.issuedAt > ACCESS_TOKEN_TTL_MS - REFRESH_MARGIN_MS) {
      await this.refresh();
    }
  }

  async refresh() {
    const res = await fetch(`${config.BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`[${this.label}] refresh falló (${res.status}): ${body.message || JSON.stringify(body)}`);
    }
    this.accessToken = body.accessToken;
    this.issuedAt = Date.now();
  }

  /**
   * request(method, path, { json, form, meta })
   * `meta` es información propia del script (dayIndex, actionId, tag de
   * escenario de contención, timestamp simulado planeado) que NO se manda al
   * server — solo se loguea junto a la respuesta, para que audit.js pueda
   * cruzar "qué se planeó" con "qué pasó realmente".
   *
   * Nunca lanza por un status HTTP de error — devuelve { ok, status, body,
   * durationMs } siempre. El caller decide si un 409/404 es un fallo real o
   * el resultado esperado de un escenario de contención.
   */
  async request(method, urlPath, { json, form, meta = {} } = {}) {
    await this.ensureFreshToken();

    const headers = { Authorization: `Bearer ${this.accessToken}` };
    let body;
    if (form) {
      body = form; // FormData — fetch pone el Content-Type multipart solo
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }

    const startedAtReal = Date.now();
    const startedAtIso = new Date(startedAtReal).toISOString();
    let res, responseBody;
    try {
      res = await fetch(`${config.BASE_URL}${urlPath}`, { method, headers, body });
      responseBody = await res.json().catch(() => null);
    } catch (err) {
      logLine({
        ts: startedAtIso, actor: this.label, method, path: urlPath, meta,
        error: err.message, ok: false,
      });
      return { ok: false, status: 0, body: { message: err.message }, durationMs: Date.now() - startedAtReal };
    }
    const durationMs = Date.now() - startedAtReal;

    logLine({
      ts: startedAtIso, actor: this.label, method, path: urlPath, meta,
      requestJson: json, status: res.status, ok: res.ok, responseBody, durationMs,
    });

    return { ok: res.ok, status: res.status, body: responseBody, durationMs };
  }

  get(path, meta) { return this.request('GET', path, { meta }); }
  post(path, json, meta) { return this.request('POST', path, { json, meta }); }
  put(path, json, meta) { return this.request('PUT', path, { json, meta }); }
  postForm(path, form, meta) { return this.request('POST', path, { form, meta }); }
}

module.exports = { Session, logLine };
