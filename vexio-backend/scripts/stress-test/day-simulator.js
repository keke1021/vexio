// Simulador de "un día" — arma el plan (qué se hace, a qué hora simulada) y
// lo ejecuta como ráfagas REALMENTE concurrentes de requests HTTP contra el
// backend (Promise.all por tanda, nunca un for-loop secuencial con await uno
// por uno). Al final del día llama a timeshift.applyEvents() para corregir
// las fechas de todo lo creado en la ráfaga al horario simulado planeado.

const config = require('./config');
const { makeRng } = require('./lib/prng');
const timeshift = require('./timeshift');

const CUSTOMER_FIRST = ['Juan', 'Sofía', 'Mateo', 'Valentina', 'Lucas', 'Camila', 'Tomás', 'Julieta', 'Bruno', 'Agustina', 'Franco', 'Micaela', 'Ignacio', 'Renata'];
const CUSTOMER_LAST = ['González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Díaz', 'Romero', 'Sosa', 'Torres', 'Acosta', 'Benítez', 'Molina'];
const FAULT_TYPES = ['SCREEN', 'BATTERY', 'CHARGING', 'CAMERA', 'SPEAKER', 'BUTTON', 'WATER', 'SOFTWARE', 'OTHER'];
const FAULT_DESC = {
  SCREEN: 'Pantalla rota', BATTERY: 'Batería se descarga rápido', CHARGING: 'No carga bien',
  CAMERA: 'Cámara desenfocada', SPEAKER: 'No se escucha en llamadas', BUTTON: 'Botón trabado',
  WATER: 'Cayó en agua', SOFTWARE: 'Reinicios aleatorios', OTHER: 'Revisión general',
};
const REPAIR_STATUS_FLOW = ['RECEIVED', 'DIAGNOSING', 'IN_PROGRESS', 'WAITING_PARTS', 'READY', 'DELIVERED'];

const atTime = (dayBase, hour, minute, second = 0) => {
  const d = new Date(dayBase);
  d.setHours(hour, minute, second, 0);
  return d;
};
const randomCustomerName = (rng) => `${rng.pick(CUSTOMER_FIRST)} ${rng.pick(CUSTOMER_LAST)}`;
const randomPhone = (rng) => `11-${rng.randInt(3000, 6999)}-${rng.randInt(1000, 9999)}`;

async function runBatched(thunks, batchSize) {
  for (let i = 0; i < thunks.length; i += batchSize) {
    const batch = thunks.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((fn) => fn()));
  }
}

// ─── Reposición de stock ────────────────────────────────────────────────────

async function checkAndRestock({ ownerSession, tiendas, dayIndex, dayBase, tenantId }) {
  const avgSalesPerDayPerTienda = (config.SALES_PER_DAY.min + config.SALES_PER_DAY.max) / 2 / tiendas.length;
  const threshold = avgSalesPerDayPerTienda * config.RESTOCK_RUNWAY_DAYS;
  const restockEvents = [];
  const rng = makeRng(1000 + dayIndex);
  const { buildInventoryRows, uploadInventoryBatch } = require('./bootstrap');

  for (const t of tiendas) {
    const r = await ownerSession.get(`/inventory?status=AVAILABLE&tiendaId=${t.id}&pageSize=1`, { phase: 'restock-check', dayIndex, tiendaKey: t.key });
    const available = r.body?.total ?? 0;
    if (available < threshold) {
      const units = rng.randInt(config.RESTOCK_BATCH_UNITS.min, config.RESTOCK_BATCH_UNITS.max);
      const prefix = `VXR-D${dayIndex}`;
      const rows = buildInventoryRows(rng, t.key, units, prefix);
      await uploadInventoryBatch(ownerSession, t.id, rows, { phase: 'restock', dayIndex, tiendaKey: t.key });
      const plannedTime = atTime(dayBase, config.BUSINESS_HOURS.openHour, 0);
      restockEvents.push({ kind: 'INVENTORY_RESTOCK', tenantId, tiendaId: t.id, imeiPrefix: `${prefix}-${t.key}`, plannedTime });
      console.log(`[día ${dayIndex}] Reposición en ${t.name}: +${units} unidades (disponible antes: ${available}, umbral: ${threshold.toFixed(0)}).`);
    }
  }
  return restockEvents;
}

// ─── Snapshot de items disponibles por tienda ──────────────────────────────

async function fetchAvailableItems(ownerSession, tienda) {
  const r = await ownerSession.get(`/inventory?status=AVAILABLE&tiendaId=${tienda.id}&pageSize=300`, { phase: 'snapshot', tiendaKey: tienda.key });
  return (r.body?.items ?? []).map((i) => i.id);
}

// ─── Construcción del plan del día ──────────────────────────────────────────

function buildRoster(employees, tiendas, dayIndex) {
  const offIdx = dayIndex % employees.length;
  const onDuty = employees.filter((_, i) => i !== offIdx);
  const roster = tiendas.map((t, i) => ({ tienda: t, employee: onDuty[i % onDuty.length] }));
  return { roster, floater: employees[offIdx] };
}

// ─── Ejecución de un día ────────────────────────────────────────────────────

async function simulateDay({ dayIndex, ctx }) {
  const { tenantId, tiendas, employees, suppliers, sessions } = ctx;
  const rng = makeRng(5000 + dayIndex);

  const dayBase = new Date(config.SIM_START);
  dayBase.setDate(dayBase.getDate() + dayIndex);
  dayBase.setHours(0, 0, 0, 0);

  console.log(`\n[día ${dayIndex}] ${dayBase.toISOString().slice(0, 10)}`);

  // ── Reposición si hace falta ────────────────────────────────────────────
  const timeshiftEvents = await checkAndRestock({ ownerSession: sessions.owner, tiendas, dayIndex, dayBase, tenantId });

  // ── Roster del día (quién abre caja en cada tienda) ─────────────────────
  const { roster, floater } = buildRoster(employees, tiendas, dayIndex);
  // Nota: las entradas de CONTENTION_SCHEDULE se usan como scratch state
  // mutable (se les cuelgan flags como _assigned/_done/tiendaId la primera
  // vez que se disparan) — cada entrada solo se consume una vez en todo el
  // run porque dayIndex es único por entrada, así que no hay riesgo de reuso.
  const contentionToday = config.CONTENTION_SCHEDULE.filter((c) => c.dayIndex === dayIndex);
  const contentionLog = [];

  const openTimes = {};
  const closeTimes = {};
  for (const t of tiendas) {
    openTimes[t.id] = atTime(dayBase, config.BUSINESS_HOURS.openHour, rng.randInt(0, config.BUSINESS_HOURS.openMinuteMax));
    closeTimes[t.id] = atTime(dayBase, config.BUSINESS_HOURS.closeHour, rng.randInt(0, config.BUSINESS_HOURS.closeMinuteMax));
  }

  // ── Apertura de caja ─────────────────────────────────────────────────────
  const doubleOpen = contentionToday.find((c) => c.type === 'DOUBLE_OPEN_CASH');
  const openActions = [];
  for (const { tienda, employee } of roster) {
    const sess = sessions.employees[employee.key];
    const meta = { phase: 'cash-open', dayIndex, tiendaKey: tienda.key, employee: employee.key };
    if (doubleOpen && doubleOpen.tiendaId === undefined && tienda === roster[0].tienda) {
      // Escenario: dos empleados intentan abrir la MISMA tienda al mismo
      // tiempo. Se usa el floater + el titular de turno, ambos en simultáneo.
      doubleOpen.tiendaId = tienda.id;
      const floaterSess = sessions.employees[floater.key];
      openActions.push(async () => {
        const [r1, r2] = await Promise.all([
          sess.post('/cash/open', { tiendaId: tienda.id, initialAmounts: { ARS: rng.randInt(50, 150) * 1000 } }, { ...meta, contention: 'DOUBLE_OPEN_CASH', role: 'A' }),
          floaterSess.post('/cash/open', { tiendaId: tienda.id, initialAmounts: { ARS: rng.randInt(50, 150) * 1000 } }, { ...meta, contention: 'DOUBLE_OPEN_CASH', role: 'B', employee: floater.key }),
        ]);
        contentionLog.push({ type: 'DOUBLE_OPEN_CASH', dayIndex, tiendaId: tienda.id, tiendaKey: tienda.key, attempts: [{ actor: employee.key, status: r1.status, ok: r1.ok, sessionId: r1.body?.id }, { actor: floater.key, status: r2.status, ok: r2.ok, sessionId: r2.body?.id }] });
        for (const r of [r1, r2]) {
          if (r.ok) timeshiftEvents.push({ kind: 'CASH_SESSION_OPEN', id: r.body.id, plannedTime: openTimes[tienda.id] });
        }
      });
    } else {
      openActions.push(async () => {
        const r = await sess.post('/cash/open', { tiendaId: tienda.id, initialAmounts: { ARS: rng.randInt(50, 150) * 1000 } }, meta);
        if (r.ok) timeshiftEvents.push({ kind: 'CASH_SESSION_OPEN', id: r.body.id, plannedTime: openTimes[tienda.id] });
        else console.warn(`[día ${dayIndex}] apertura de caja falló en ${tienda.name}:`, r.status, r.body?.message);
      });
    }
  }
  await runBatched(openActions, config.CONCURRENCY_BATCH_SIZE);

  // ── Ventas del día ───────────────────────────────────────────────────────
  const salesTarget = rng.randInt(config.SALES_PER_DAY.min, config.SALES_PER_DAY.max);
  const perTienda = tiendas.map(() => Math.floor(salesTarget / tiendas.length));
  perTienda[0] += salesTarget - perTienda.reduce((a, b) => a + b, 0);

  const doubleSell = contentionToday.find((c) => c.type === 'DOUBLE_SELL_SAME_IMEI');
  const saleActions = [];
  let actualSalesPlanned = 0;

  for (let ti = 0; ti < tiendas.length; ti++) {
    const tienda = tiendas[ti];
    const availableIds = await fetchAvailableItems(sessions.owner, tienda);
    const shuffled = [...availableIds].sort(() => rng.rand() - 0.5);

    let wanted = perTienda[ti];
    let contentionItem = null;
    if (doubleSell && !doubleSell._assigned && shuffled.length > 0) {
      contentionItem = shuffled.pop();
      doubleSell._assigned = true;
    }
    if (shuffled.length < wanted) {
      console.warn(`[día ${dayIndex}] ${tienda.name}: solo ${shuffled.length} items disponibles, se ajusta de ${wanted} a ${shuffled.length} ventas planeadas.`);
      wanted = shuffled.length;
    }
    actualSalesPlanned += wanted + (contentionItem ? 1 : 0);

    const saleTimeFor = () => atTime(dayBase, rng.randInt(config.BUSINESS_HOURS.openHour + 1, config.BUSINESS_HOURS.closeHour - 1), rng.randInt(0, 59));

    for (let k = 0; k < wanted; k++) {
      const itemId = shuffled[k];
      const employee = rng.pick(employees);
      const currency = rng.pickWeighted(config.CURRENCY_WEIGHTS);
      const paymentMethod = rng.pickWeighted(config.PAYMENT_METHOD_WEIGHTS);
      const withCustomer = rng.chance(config.CUSTOMER_ASSOC_PROB);
      const plannedTime = saleTimeFor();
      saleActions.push(async () => {
        const sess = sessions.employees[employee.key];
        const payload = {
          items: [{ inventoryItemId: itemId }], paymentMethod, currency, tiendaId: tienda.id,
          ...(withCustomer ? { customerName: randomCustomerName(rng), customerPhone: randomPhone(rng) } : {}),
        };
        const r = await sess.post('/pos/sales', payload, { phase: 'sale', dayIndex, tiendaKey: tienda.key, employee: employee.key });
        if (r.ok) timeshiftEvents.push({ kind: 'SALE', id: r.body.id, plannedTime });
        else console.warn(`[día ${dayIndex}] venta falló en ${tienda.name} (${employee.key}):`, r.status, r.body?.message);
      });
    }

    if (contentionItem) {
      const [empA, empB] = [employees[0], employees[1]].map((e) => (e ? e : employees[0]));
      const otherEmp = employees.find((e) => e.key !== empA.key) || empB;
      const plannedTime = saleTimeFor();
      const currency = rng.pickWeighted(config.CURRENCY_WEIGHTS);
      const paymentMethod = rng.pickWeighted(config.PAYMENT_METHOD_WEIGHTS);
      saleActions.push(async () => {
        const sessA = sessions.employees[empA.key];
        const sessB = sessions.employees[otherEmp.key];
        const payload = (extra) => ({ items: [{ inventoryItemId: contentionItem }], paymentMethod, currency, tiendaId: tienda.id, ...extra });
        const [rA, rB] = await Promise.all([
          sessA.post('/pos/sales', payload({ customerName: randomCustomerName(rng) }), { phase: 'sale', dayIndex, tiendaKey: tienda.key, employee: empA.key, contention: 'DOUBLE_SELL_SAME_IMEI', role: 'A' }),
          sessB.post('/pos/sales', payload({ customerName: randomCustomerName(rng) }), { phase: 'sale', dayIndex, tiendaKey: tienda.key, employee: otherEmp.key, contention: 'DOUBLE_SELL_SAME_IMEI', role: 'B' }),
        ]);
        contentionLog.push({
          type: 'DOUBLE_SELL_SAME_IMEI', dayIndex, tiendaId: tienda.id, tiendaKey: tienda.key, inventoryItemId: contentionItem,
          attempts: [
            { actor: empA.key, status: rA.status, ok: rA.ok, saleId: rA.body?.id },
            { actor: otherEmp.key, status: rB.status, ok: rB.ok, saleId: rB.body?.id },
          ],
        });
        for (const r of [rA, rB]) {
          if (r.ok) timeshiftEvents.push({ kind: 'SALE', id: r.body.id, plannedTime });
        }
      });
    }
  }
  await runBatched(saleActions, config.CONCURRENCY_BATCH_SIZE);

  // ── Movimientos manuales de caja ─────────────────────────────────────────
  const movementActions = [];
  for (const { tienda, employee } of roster) {
    const count = rng.randInt(config.MANUAL_MOVEMENTS_PER_TIENDA_PER_DAY.min, config.MANUAL_MOVEMENTS_PER_TIENDA_PER_DAY.max);
    for (let k = 0; k < count; k++) {
      const isExpense = rng.chance(0.75);
      const currencyCode = rng.chance(0.82) ? 'ARS' : rng.pick(['USD', 'USDT']);
      const range = currencyCode === 'ARS' ? [8000, 180000] : [15, 200];
      const amount = parseFloat(rng.randFloat(range[0], range[1]).toFixed(2));
      const plannedTime = atTime(dayBase, rng.randInt(config.BUSINESS_HOURS.openHour + 1, config.BUSINESS_HOURS.closeHour - 1), rng.randInt(0, 59));
      movementActions.push(async () => {
        const sess = sessions.employees[employee.key];
        const r = await sess.post('/cash/movements', {
          tiendaId: tienda.id, type: isExpense ? 'EXPENSE' : 'INCOME', amount, currencyCode,
          description: isExpense ? 'Gasto operativo' : 'Ingreso manual', paymentMethod: 'CASH',
        }, { phase: 'movement', dayIndex, tiendaKey: tienda.key, employee: employee.key });
        if (r.ok) timeshiftEvents.push({ kind: 'CASH_MOVEMENT', id: r.body.id, plannedTime });
      });
    }
  }
  await runBatched(movementActions, config.CONCURRENCY_BATCH_SIZE);

  // ── Reparaciones — altas ─────────────────────────────────────────────────
  const repairActions = [];
  const newRepairIds = [];
  if (rng.chance(config.REPAIRS_NEW_PER_DAY_PROB)) {
    const nNew = rng.randInt(1, 2);
    for (let k = 0; k < nNew; k++) {
      const employee = rng.pick(employees);
      const faultType = rng.pick(FAULT_TYPES);
      const plannedTime = atTime(dayBase, rng.randInt(config.BUSINESS_HOURS.openHour, config.BUSINESS_HOURS.closeHour - 1), rng.randInt(0, 59));
      repairActions.push(async () => {
        const sess = sessions.employees[employee.key];
        const r = await sess.post('/repairs', {
          customerName: randomCustomerName(rng), customerPhone: randomPhone(rng),
          deviceModel: rng.pick(['iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 13 Pro Max', 'iPhone 14']),
          faultType, faultDescription: FAULT_DESC[faultType],
          budget: Math.round(rng.randFloat(15000, 150000) / 500) * 500,
        }, { phase: 'repair-create', dayIndex, employee: employee.key });
        if (r.ok) {
          timeshiftEvents.push({ kind: 'REPAIR_CREATE', id: r.body.id, plannedTime });
          newRepairIds.push({ id: r.body.id, status: 'RECEIVED' });
        }
      });
    }
  }

  // ── Reparaciones — actualizaciones de estado ────────────────────────────
  const openRepairs = ctx.repairsPool.filter((r) => !['DELIVERED', 'CANCELLED'].includes(r.status));
  if (rng.chance(config.REPAIRS_UPDATE_PER_DAY_PROB) && openRepairs.length) {
    const nUpdates = Math.min(openRepairs.length, rng.randInt(1, 3));
    const toUpdate = [...openRepairs].sort(() => rng.rand() - 0.5).slice(0, nUpdates);
    for (const rep of toUpdate) {
      const idx = REPAIR_STATUS_FLOW.indexOf(rep.status);
      const newStatus = REPAIR_STATUS_FLOW[Math.min(idx + 1, REPAIR_STATUS_FLOW.length - 1)];
      const employee = rng.pick(employees);
      const plannedTime = atTime(dayBase, rng.randInt(config.BUSINESS_HOURS.openHour, config.BUSINESS_HOURS.closeHour - 1), rng.randInt(0, 59));
      repairActions.push(async () => {
        const sess = sessions.employees[employee.key];
        const r = await sess.put(`/repairs/${rep.id}`, { status: newStatus }, { phase: 'repair-update', dayIndex, employee: employee.key });
        if (r.ok) {
          timeshiftEvents.push({ kind: 'REPAIR_UPDATE', id: rep.id, plannedTime, newStatus });
          rep.status = newStatus;
        }
      });
    }
  }
  await runBatched(repairActions, config.CONCURRENCY_BATCH_SIZE);
  ctx.repairsPool.push(...newRepairIds);

  // ── Actividad intermitente del dueño (proveedores) ──────────────────────
  const ownerActions = [];
  const supplierPaymentRace = contentionToday.find((c) => c.type === 'SUPPLIER_PAYMENT_VS_SALE_RACE');

  if (config.SUPPLIER_NEW.dayIndex === dayIndex) {
    ownerActions.push(async () => {
      const plannedTime = atTime(dayBase, 11, rng.randInt(0, 59));
      const r = await sessions.owner.post('/suppliers', {
        name: config.SUPPLIER_NEW.name, city: config.SUPPLIER_NEW.city, paymentDays: config.SUPPLIER_NEW.paymentDays,
        phone: config.SUPPLIER_NEW.phone, email: config.SUPPLIER_NEW.email,
      }, { phase: 'owner-new-supplier', dayIndex });
      if (r.ok) {
        timeshiftEvents.push({ kind: 'SUPPLIER_CREATE', id: r.body.id, plannedTime });
        suppliers.push({ id: r.body.id, name: config.SUPPLIER_NEW.name, currency: config.SUPPLIER_NEW.currency });
      }
    });
  }

  // Escenario de contención programado — se fuerza de forma determinística
  // en su día (no depende de la tirada probabilística de abajo, para
  // garantizar que los 9 escenarios del diseño realmente ocurren). Si no hay
  // todavía una orden RECEIVED con saldo pendiente, se crea y recibe una
  // chica exclusivamente para poder disparar la carrera.
  if (supplierPaymentRace && suppliers.length) {
    ownerActions.push(async () => {
      const supplier = suppliers[0];
      const tienda = tiendas[0];
      let order = ctx.purchaseOrders.find((o) => o.supplierId === supplier.id && o.status === 'RECEIVED' && o.pending > 0);

      if (!order) {
        const unitRange = supplier.currency === 'ARS' ? [40000, 220000] : [30, 220];
        const items = [{ description: 'Lote para prueba de contención', quantity: 2, unitPrice: parseFloat(rng.randFloat(unitRange[0], unitRange[1]).toFixed(2)) }];
        const total = items[0].quantity * items[0].unitPrice;
        const createR = await sessions.owner.post(`/suppliers/${supplier.id}/orders`, { items, currency: supplier.currency }, { phase: 'owner-po-create-for-contention', dayIndex });
        if (!createR.ok) { console.warn(`[día ${dayIndex}] no se pudo crear la orden para forzar SUPPLIER_PAYMENT_VS_SALE_RACE:`, createR.body?.message); return; }
        timeshiftEvents.push({ kind: 'PURCHASE_ORDER_CREATE', id: createR.body.id, plannedTime: atTime(dayBase, 9, 30) });

        const receiveR = await sessions.owner.put(`/suppliers/${supplier.id}/orders/${createR.body.id}`, { status: 'RECEIVED' }, { phase: 'owner-po-receive-for-contention', dayIndex });
        if (!receiveR.ok) { console.warn(`[día ${dayIndex}] no se pudo recibir la orden para forzar SUPPLIER_PAYMENT_VS_SALE_RACE:`, receiveR.body?.message); return; }
        timeshiftEvents.push({ kind: 'PURCHASE_ORDER_RECEIVE', id: createR.body.id, plannedTime: atTime(dayBase, 9, 45) });

        order = { id: createR.body.id, supplierId: supplier.id, currency: supplier.currency, total, pending: total, status: 'RECEIVED' };
        ctx.purchaseOrders.push(order);
      }

      const amount = parseFloat((order.pending * rng.randFloat(0.5, 1)).toFixed(2));
      const employee = rng.pick(employees);
      const plannedTime = atTime(dayBase, rng.randInt(13, 17), rng.randInt(0, 59));
      const payBody = { amount, currency: order.currency, source: 'CASH_REGISTER', tiendaId: tienda.id };

      const [rPay, rSale] = await Promise.all([
        sessions.owner.post(`/suppliers/orders/${order.id}/payments`, payBody, { phase: 'owner-po-payment', dayIndex, contention: 'SUPPLIER_PAYMENT_VS_SALE_RACE', role: 'A' }),
        (async () => {
          const items = await fetchAvailableItems(sessions.owner, tienda);
          if (!items.length) return { ok: false, status: 0, body: {} };
          return sessions.employees[employee.key].post('/pos/sales', {
            items: [{ inventoryItemId: items[0] }], paymentMethod: 'CASH', currency: 'ARS', tiendaId: tienda.id,
          }, { phase: 'sale', dayIndex, tiendaKey: tienda.key, employee: employee.key, contention: 'SUPPLIER_PAYMENT_VS_SALE_RACE', role: 'B' });
        })(),
      ]);
      contentionLog.push({
        type: 'SUPPLIER_PAYMENT_VS_SALE_RACE', dayIndex, tiendaId: tienda.id, tiendaKey: tienda.key,
        attempts: [
          { actor: 'OWNER', kind: 'payment', status: rPay.status, ok: rPay.ok, id: rPay.body?.id },
          { actor: employee.key, kind: 'sale', status: rSale.status, ok: rSale.ok, id: rSale.body?.id },
        ],
      });
      if (rPay.ok) { timeshiftEvents.push({ kind: 'SUPPLIER_PAYMENT', id: rPay.body.id, plannedTime }); order.pending -= amount; }
      if (rSale.ok) timeshiftEvents.push({ kind: 'SALE', id: rSale.body.id, plannedTime });
    });
  }

  if (rng.chance(config.OWNER_ACTIVITY_PROB) && suppliers.length) {
    const supplier = rng.pick(suppliers);
    const plannedTime = atTime(dayBase, rng.randInt(10, 18), rng.randInt(0, 59));
    const tienda = rng.pick(tiendas);
    const action = rng.pick(['NEW_ORDER', 'PAY_PENDING']);

    if (action === 'NEW_ORDER' || !ctx.purchaseOrders.some((o) => o.supplierId === supplier.id && o.pending > 0)) {
      const nItems = rng.randInt(2, 4);
      const unitRange = supplier.currency === 'ARS' ? [40000, 220000] : [30, 220];
      const items = Array.from({ length: nItems }, () => ({
        description: 'Lote de equipos', quantity: rng.randInt(1, 5), unitPrice: parseFloat(rng.randFloat(unitRange[0], unitRange[1]).toFixed(2)),
      }));
      const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const withDownPayment = rng.chance(0.5);
      const downAmount = withDownPayment ? parseFloat((total * rng.randFloat(0.3, 0.5)).toFixed(2)) : 0;

      ownerActions.push(async () => {
        const body = { items, currency: supplier.currency };
        if (downAmount > 0) {
          body.downPayment = { amount: downAmount, source: rng.chance(0.5) ? 'CASH_REGISTER' : 'EXTERNAL', tiendaId: tienda.id };
        }
        const r = await sessions.owner.post(`/suppliers/${supplier.id}/orders`, body, { phase: 'owner-po-create', dayIndex, supplier: supplier.name });
        if (r.ok) {
          timeshiftEvents.push({ kind: 'PURCHASE_ORDER_CREATE', id: r.body.id, plannedTime, downPaymentId: r.body.payments?.[0]?.id });
          ctx.purchaseOrders.push({ id: r.body.id, supplierId: supplier.id, currency: supplier.currency, total, pending: total - downAmount, status: 'PENDING', createdDayIndex: dayIndex });
        }
      });
    } else {
      // Pago "normal" (sin contención) contra el pendiente de una orden ya
      // recibida — el escenario de carrera con contención se maneja aparte,
      // de forma determinística, en el bloque de arriba (supplierPaymentRace).
      const order = ctx.purchaseOrders.find((o) => o.supplierId === supplier.id && o.pending > 0);
      if (order) {
        const amount = parseFloat((order.pending * rng.randFloat(0.5, 1)).toFixed(2));
        ownerActions.push(async () => {
          const payBody = { amount, currency: order.currency, source: 'CASH_REGISTER', tiendaId: tienda.id };
          const r = await sessions.owner.post(`/suppliers/orders/${order.id}/payments`, payBody, { phase: 'owner-po-payment', dayIndex });
          if (r.ok) { timeshiftEvents.push({ kind: 'SUPPLIER_PAYMENT', id: r.body.id, plannedTime }); order.pending -= amount; }
        });
      }
    }
  }

  // Marcar RECEIVED alguna orden PENDING vieja de tanto en tanto
  const pendingOld = ctx.purchaseOrders.find((o) => o.status === 'PENDING' && dayIndex - (o.createdDayIndex ?? 0) >= 3);
  if (pendingOld && rng.chance(0.5)) {
    const plannedTime = atTime(dayBase, rng.randInt(10, 18), rng.randInt(0, 59));
    ownerActions.push(async () => {
      const r = await sessions.owner.put(`/suppliers/${pendingOld.supplierId}/orders/${pendingOld.id}`, { status: 'RECEIVED' }, { phase: 'owner-po-receive', dayIndex });
      if (r.ok) { timeshiftEvents.push({ kind: 'PURCHASE_ORDER_RECEIVE', id: pendingOld.id, plannedTime }); pendingOld.status = 'RECEIVED'; }
    });
  }

  await runBatched(ownerActions, config.CONCURRENCY_BATCH_SIZE);

  // ── Cierre de caja ───────────────────────────────────────────────────────
  const closeRace = contentionToday.find((c) => c.type === 'CLOSE_VS_SALE_RACE');
  const closeActions = [];
  for (const { tienda, employee } of roster) {
    const sess = sessions.employees[employee.key];
    const adjust = rng.chance(config.CLOSE_ADJUSTMENT_PROB);
    const countedAmounts = adjust ? { ARS: rng.randInt(-500, 500) } : {}; // el backend suma diff contra lo calculado; con ARS relativo alcanza para generar un ajuste chico
    const meta = { phase: 'cash-close', dayIndex, tiendaKey: tienda.key, employee: employee.key };

    if (closeRace && closeRace.tiendaId === undefined) {
      closeRace.tiendaId = tienda.id;
      const items = await fetchAvailableItems(sessions.owner, tienda);
      closeActions.push(async () => {
        const [rClose, rSale] = await Promise.all([
          sess.post('/cash/close', { tiendaId: tienda.id }, { ...meta, contention: 'CLOSE_VS_SALE_RACE', role: 'A' }),
          items.length
            ? sessions.employees[floater.key].post('/pos/sales', { items: [{ inventoryItemId: items[0] }], paymentMethod: 'CASH', currency: 'ARS', tiendaId: tienda.id }, { ...meta, contention: 'CLOSE_VS_SALE_RACE', role: 'B', employee: floater.key })
            : Promise.resolve({ ok: false, status: 0, body: {} }),
        ]);
        contentionLog.push({
          type: 'CLOSE_VS_SALE_RACE', dayIndex, tiendaId: tienda.id, tiendaKey: tienda.key,
          attempts: [{ actor: employee.key, kind: 'close', status: rClose.status, ok: rClose.ok }, { actor: floater.key, kind: 'sale', status: rSale.status, ok: rSale.ok, saleId: rSale.body?.id }],
        });
        if (rClose.ok) timeshiftEvents.push({ kind: 'CASH_SESSION_CLOSE', id: rClose.body.session.id, plannedTime: closeTimes[tienda.id] });
        if (rSale.ok) timeshiftEvents.push({ kind: 'SALE', id: rSale.body.id, plannedTime: closeTimes[tienda.id] });
      });
    } else {
      closeActions.push(async () => {
        const r = await sess.post('/cash/close', { tiendaId: tienda.id, countedAmounts }, meta);
        if (r.ok) timeshiftEvents.push({ kind: 'CASH_SESSION_CLOSE', id: r.body.session.id, plannedTime: closeTimes[tienda.id] });
        else console.warn(`[día ${dayIndex}] cierre de caja falló en ${tienda.name}:`, r.status, r.body?.message);
      });
    }
  }
  await runBatched(closeActions, config.CONCURRENCY_BATCH_SIZE);

  // ── Corrección de timestamps del día ────────────────────────────────────
  const { failed } = await timeshift.applyEvents(timeshiftEvents);

  console.log(`[día ${dayIndex}] ventas planeadas: ${actualSalesPlanned} | eventos: ${timeshiftEvents.length} (${failed.length} fallos de timeshift) | contención: ${contentionLog.length}`);

  return { contentionLog, salesPlanned: actualSalesPlanned };
}

module.exports = { simulateDay };
