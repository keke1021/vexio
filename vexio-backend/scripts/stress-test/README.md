# Stress test funcional — tenant descartable

Simula 15-20 días de operación real de una tienda (3 empleados + dueño
intermitente) con requests HTTP **realmente concurrentes** contra el backend,
para encontrar bugs de concurrencia/consistencia de datos antes de producción.
No mide performance/carga — el objetivo es encontrar bugs, no medir tiempos.

Corre contra un tenant nuevo y descartable (`Stress Test <fecha-hora>`).
**Nunca toca ningún tenant real ni el dataset de `seed:demo`.**

## Requisitos

- El backend tiene que estar corriendo (`npm run dev`, en otra terminal),
  escuchando en el puerto de `STRESS_BASE_URL` (default `http://localhost:3001/api`).
- Las credenciales de SUPERADMIN reales (default `ezequiel4600@gmail.com` /
  `admin1234` — sobreescribibles con `STRESS_SUPERADMIN_EMAIL`/`STRESS_SUPERADMIN_PASSWORD`).

## Uso

```bash
cd vexio-backend

# Fase 1 — crea el tenant, corre los N días simulados con concurrencia real
# y los escenarios de contención intencional. Tarda minutos/horas reales
# según STRESS_SIM_DAYS, pero deja los timestamps distribuidos en 15-20 días
# simulados (ver "Cómo funcionan los timestamps" abajo).
npm run stress:run

# Fase 2 + Fase 3 — audita lo que quedó en la DB y lo compara contra los
# endpoints reales de Reportes/Caja/Proveedores. Necesita el backend
# corriendo (Fase 3 le pega a los endpoints de verdad).
npm run stress:audit

# Cuando ya revisaste el reporte y no hace falta seguir operando el tenant:
# lo marca SUSPENDED (nunca se borra — mismo criterio que "Demo UX Caja").
npm run stress:finalize
```

El reporte final queda en `out/audit-report-<fecha>.md` — ✅ lo que cuadra,
❌ el detalle exacto de cada inconsistencia (tabla, IDs, discrepancia).

## Configuración

Todo vive en `config.js` — días simulados, cantidad de tiendas/empleados,
volumen de ventas/día, y el calendario de escenarios de contención
(`CONTENTION_SCHEDULE`). Ajustable con variables de entorno:

- `STRESS_BASE_URL` — default `http://localhost:3001/api`
- `STRESS_SIM_DAYS` — default `18`
- `STRESS_SUPERADMIN_EMAIL` / `STRESS_SUPERADMIN_PASSWORD`

## Cómo funcionan los timestamps

Ningún endpoint de escritura acepta un `createdAt` custom — así que la
concurrencia real ocurre contra los controllers en ráfagas de tiempo real
(cada "día simulado" es una ráfaga de peticiones concurrentes que tarda
minutos reales), y al cerrar cada día un módulo aparte (`timeshift.js`)
corrige, vía Prisma directo, la fecha de cada fila creada al horario
planeado dentro del día simulado correspondiente — mismo patrón que ya usa
`seed-demo.js` para poblar fechas a mano. No es un cambio de producción.

## Estructura

- `config.js` — toda la volumetría y el calendario de contención
- `bootstrap.js` — crea el tenant/tiendas/usuarios/proveedores/inventario inicial
- `day-simulator.js` — arma y ejecuta cada día simulado (concurrencia real + contención)
- `timeshift.js` — corrige timestamps post-ráfaga
- `run.js` — orquestador de Fase 1
- `audit.js` — Fase 2 (auditoría) + Fase 3 (comparación contra endpoints reales)
- `finalize.js` — marca el tenant SUSPENDED al final (manual, no automático)
- `lib/` — helpers compartidos (PRNG determinístico, catálogo de productos, cliente HTTP con refresh de token)
- `out/` — logs de cada corrida (`run-log-*.jsonl`, `contention-log-*.json`, `audit-report-*.md`, `last-run.json`)

## Decisiones de diseño ya aprobadas

- Los 3 "empleados" son rol `ADMIN` (no `SELLER`) — `cash.controller.js`
  gatea `open`/`close`/`movements` a OWNER/ADMIN, un SELLER no puede.
- Sin `StockTransfer` entre sucursales — no está implementado en el sistema,
  cada tienda repone su propio stock de forma independiente.
- La sesión de SUPERADMIN se usa EXCLUSIVAMENTE para rutas `/admin/tenants/**`
  (crear tenant, tiendas, usuarios) — todo lo demás (ventas, caja,
  proveedores, inventario) usa el token del OWNER o de un empleado del
  tenant nuevo, nunca el de SUPERADMIN, para no escribir por accidente en el
  tenant real de SyntraTech.
