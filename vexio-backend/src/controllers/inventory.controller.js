const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const calcMargin = (cost, sale) => {
  const s = parseFloat(sale);
  if (!s) return 0;
  return parseFloat((((s - parseFloat(cost)) / s) * 100).toFixed(2));
};

// Prisma retorna Decimal como objeto — lo serializamos a float para JSON
const serializeItem = (item) => ({
  ...item,
  costPrice: parseFloat(item.costPrice),
  salePrice: parseFloat(item.salePrice),
  margin: calcMargin(item.costPrice, item.salePrice),
});

// ─── Inventory ────────────────────────────────────────────────────────────────

/**
 * GET /api/inventory
 * Filtros: condition, status, productId, tiendaId, modelo (nombre de
 * producto, parcial), imei (arranca-con, no parcial en cualquier posición —
 * antes "search" mezclaba ambos en un OR parcial: buscar "16" para
 * "iPhone 16" también traía cualquier IMEI que tuviera "16" en el medio).
 * Paginado: page/pageSize (default 1/50) — el total y totalPages reflejan
 * los filtros activos, no el inventario completo.
 * Por defecto excluye los items con status DEFECTIVE.
 */
const getAll = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { condition, status, productId, tiendaId, modelo, imei, page = 1, pageSize = 50 } = req.query;

    const where = {
      tenantId,
      // Si no se pide un status específico, se ocultan los dados de baja
      ...(status ? { status } : { status: { not: 'DEFECTIVE' } }),
      ...(condition && { condition }),
      ...(productId && { productId }),
      ...(tiendaId && { tiendaId }),
      ...(modelo && { product: { name: { contains: modelo, mode: 'insensitive' } } }),
      ...(imei && { imei: { startsWith: imei, mode: 'insensitive' } }),
    };

    const pageNum     = Math.max(parseInt(page) || 1, 1);
    const pageSizeNum = Math.max(parseInt(pageSize) || 50, 1);

    const [items, total] = await prisma.$transaction([
      prisma.inventoryItem.findMany({
        where,
        include: {
          product: true,
          supplier: { select: { id: true, name: true, city: true } },
          tienda: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    // Stock disponible por producto (para calcular badge de estado en frontend)
    const productIds = [...new Set(items.map((i) => i.productId))];
    const stockGroups = await prisma.inventoryItem.groupBy({
      by: ['productId'],
      where: { tenantId, status: 'AVAILABLE', productId: { in: productIds } },
      _count: { id: true },
    });

    const stockMap = Object.fromEntries(stockGroups.map((g) => [g.productId, g._count.id]));

    const result = items.map((item) => ({
      ...serializeItem(item),
      stockCount: stockMap[item.productId] ?? 0,
    }));

    res.json({
      items: result,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.max(Math.ceil(total / pageSizeNum), 1),
    });
  } catch (error) {
    console.error('[inventory:getAll]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/inventory/alerts
 * Devuelve modelos cuyo stock disponible es <= minStock.
 * IMPORTANTE: esta ruta debe definirse ANTES de /:id en el router.
 */
const getAlerts = async (req, res) => {
  try {
    const { tenantId } = req.user;

    const products = await prisma.product.findMany({
      where: { tenantId },
      include: {
        _count: { select: { items: { where: { status: 'AVAILABLE' } } } },
      },
    });

    const alerts = products
      .filter((p) => p._count.items <= p.minStock)
      .map((p) => ({
        product: { id: p.id, name: p.name, color: p.color, storage: p.storage, minStock: p.minStock },
        availableCount: p._count.items,
        severity: p._count.items === 0 ? 'out' : p._count.items === 1 ? 'last' : 'low',
      }))
      .sort((a, b) => a.availableCount - b.availableCount);

    res.json({ alerts, total: alerts.length });
  } catch (error) {
    console.error('[inventory:getAlerts]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/inventory/:id
 */
const getById = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;
    const { tiendaId } = req.query;

    const item = await prisma.inventoryItem.findFirst({
      where: { id, tenantId, ...(tiendaId && { tiendaId }) },
      include: { product: true, supplier: true, tienda: { select: { id: true, name: true } } },
    });

    if (!item) return res.status(404).json({ message: 'Equipo no encontrado.' });

    const stockCount = await prisma.inventoryItem.count({
      where: { tenantId, productId: item.productId, status: 'AVAILABLE' },
    });

    res.json({ ...serializeItem(item), stockCount });
  } catch (error) {
    console.error('[inventory:getById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/inventory
 * Crea un InventoryItem. Si el modelo (Product) no existe lo crea automáticamente.
 * IMEI es opcional — no todo lo que se vende tiene uno real (fundas,
 * cargadores, accesorios). Si no viene, se genera un placeholder
 * VX-{timestamp}-{random4} — mismo criterio que bulkUpload, para que el
 * alta manual y la masiva se comporten igual.
 */
const create = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { productName, color, storage, imei, condition, costPrice, salePrice, currencyCode, supplierId, accessories, notes, tiendaId } = req.body;

    if (!productName || !color || !storage || costPrice == null || salePrice == null || !tiendaId) {
      return res.status(400).json({ message: 'Campos requeridos: modelo, color, storage, costo, precio de venta y tienda.' });
    }

    const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const finalImei = imei?.trim() || `VX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const existing = await prisma.inventoryItem.findUnique({
      where: { imei_tenantId: { imei: finalImei, tenantId } },
    });
    if (existing) {
      return res.status(409).json({ message: `El IMEI ${finalImei} ya existe en tu inventario.` });
    }

    const validCurrencies = await prisma.currency.findMany({ where: { isActive: true }, select: { code: true } });
    const validCodes = new Set(validCurrencies.map((c) => c.code));

    // findOrCreate del modelo: mismo nombre+color+storage dentro del tenant
    const product = await prisma.product.upsert({
      where: { name_color_storage_tenantId: { name: productName, color, storage, tenantId } },
      update: {},
      create: { name: productName, color, storage, tenantId },
    });

    const item = await prisma.inventoryItem.create({
      data: {
        imei: finalImei,
        condition: condition || 'NEW',
        costPrice: parseFloat(costPrice),
        salePrice: parseFloat(salePrice),
        currencyCode: validCodes.has(currencyCode) ? currencyCode : 'ARS',
        accessories: accessories || [],
        notes: notes || null,
        productId: product.id,
        supplierId: supplierId || null,
        tenantId,
        tiendaId,
      },
      include: { product: true, supplier: true, tienda: { select: { id: true, name: true } } },
    });

    res.status(201).json(serializeItem(item));
  } catch (error) {
    console.error('[inventory:create]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/inventory/:id
 * Solo actualiza los campos enviados.
 */
const update = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;
    const { salePrice, costPrice, condition, status, notes, accessories } = req.body;

    const existing = await prisma.inventoryItem.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ message: 'Equipo no encontrado.' });

    const updated = await prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(salePrice != null && { salePrice: parseFloat(salePrice) }),
        ...(costPrice != null && { costPrice: parseFloat(costPrice) }),
        ...(condition && { condition }),
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
        ...(accessories !== undefined && { accessories }),
      },
      include: { product: true, supplier: true },
    });

    res.json(serializeItem(updated));
  } catch (error) {
    console.error('[inventory:update]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * DELETE /api/inventory/:id
 * Soft delete: marca el item como DEFECTIVE en lugar de eliminarlo.
 */
const remove = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const existing = await prisma.inventoryItem.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ message: 'Equipo no encontrado.' });

    await prisma.inventoryItem.update({ where: { id }, data: { status: 'DEFECTIVE' } });

    res.json({ message: 'Equipo dado de baja exitosamente.' });
  } catch (error) {
    console.error('[inventory:remove]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Suppliers ────────────────────────────────────────────────────────────────

const getSuppliers = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const suppliers = await prisma.supplier.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ suppliers });
  } catch (error) {
    console.error('[suppliers:getAll]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

const createSupplier = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { name, city, paymentDays, phone, email } = req.body;

    if (!name || !city) return res.status(400).json({ message: 'Nombre y ciudad son requeridos.' });

    const existing = await prisma.supplier.findUnique({ where: { name_tenantId: { name, tenantId } } });
    if (existing) return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' });

    const supplier = await prisma.supplier.create({
      data: { name, city, paymentDays: paymentDays || 30, phone: phone || null, email: email || null, tenantId },
    });

    res.status(201).json(supplier);
  } catch (error) {
    console.error('[suppliers:create]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Tiendas (lookup para formularios) ────────────────────────────────────────
// A diferencia de /api/admin/tenants/:id/tiendas (SUPERADMIN, cualquier
// tenant), esto es self-service: cualquier usuario autenticado ve las
// sucursales de SU PROPIO tenant, para elegir en los forms de inventario.

const getTiendas = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const tiendas = await prisma.tienda.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    res.json({ tiendas });
  } catch (error) {
    console.error('[inventory:getTiendas]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Products (autocomplete) ──────────────────────────────────────────────────

const getProducts = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { search } = req.query;

    const products = await prisma.product.findMany({
      where: {
        tenantId,
        ...(search && { name: { contains: search, mode: 'insensitive' } }),
      },
      select: { id: true, name: true, color: true, storage: true, minStock: true },
      orderBy: { name: 'asc' },
      take: 30,
    });

    res.json({ products });
  } catch (error) {
    console.error('[products:getAll]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/inventory/bulk-upload
 * Carga masiva de equipos desde un archivo Excel.
 * IMEI es opcional — si no viene se genera VX-{timestamp}-{random4}.
 */
const bulkUpload = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { tiendaId } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'No se recibió ningún archivo.' });
    }

    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal que recibe la carga.' });
    }

    const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const XLSX = require('xlsx');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) {
      return res.status(400).json({ message: 'El archivo está vacío.' });
    }

    const CONDITION_MAP = {
      nuevo: 'NEW', 'como nuevo': 'LIKE_NEW',
      reacondicionado: 'REFURBISHED', usado: 'USED',
      new: 'NEW', like_new: 'LIKE_NEW', refurbished: 'REFURBISHED', used: 'USED',
    };

    const validCurrencies = await prisma.currency.findMany({ where: { isActive: true }, select: { code: true } });
    const validCodes = new Set(validCurrencies.map((c) => c.code));

    const result = { loaded: 0, failed: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      const modelo        = String(row.modelo || '').trim();
      const color         = String(row.color || '').trim();
      const almac         = String(row.almacenamiento || '').trim();
      const condRaw       = String(row.condicion || '').trim().toLowerCase();
      const costo         = parseFloat(row.costo);
      const precioVenta   = parseFloat(row.precio_venta);
      const imeiRaw       = String(row.imei || '').trim();
      const notas         = String(row.notas || '').trim() || null;
      const monedaRaw     = String(row.moneda || '').trim().toUpperCase();
      const proveedorName = String(row.proveedor || '').trim();

      // Antes esto validaba contra un array hardcodeado ['ARS','USD','USDT']
      // que ya venía correcto (tomaba la moneda de la fila, no asumía ARS
      // salvo que la celda viniera vacía o inválida) — se cambia a validar
      // contra Currency.isActive para no tener una segunda lista de monedas
      // dando vueltas por el código.
      const currencyCode = validCodes.has(monedaRaw) ? monedaRaw : 'ARS';

      if (!modelo) { result.failed++; result.errors.push({ row: rowNum, reason: 'Falta "modelo"' }); continue; }
      if (!color)  { result.failed++; result.errors.push({ row: rowNum, reason: 'Falta "color"' }); continue; }
      if (!almac)  { result.failed++; result.errors.push({ row: rowNum, reason: 'Falta "almacenamiento"' }); continue; }
      if (isNaN(costo) || costo <= 0)            { result.failed++; result.errors.push({ row: rowNum, reason: 'Campo "costo" inválido' }); continue; }
      if (isNaN(precioVenta) || precioVenta <= 0) { result.failed++; result.errors.push({ row: rowNum, reason: 'Campo "precio_venta" inválido' }); continue; }

      const imei = imeiRaw || `VX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const condition = CONDITION_MAP[condRaw] || 'NEW';

      try {
        const existing = await prisma.inventoryItem.findUnique({
          where: { imei_tenantId: { imei, tenantId } },
        });
        if (existing) {
          result.failed++;
          result.errors.push({ row: rowNum, reason: `IMEI "${imei}" ya existe` });
          continue;
        }

        const product = await prisma.product.upsert({
          where: { name_color_storage_tenantId: { name: modelo, color, storage: almac, tenantId } },
          update: {},
          create: { name: modelo, color, storage: almac, tenantId },
        });

        let supplierId = null;
        if (proveedorName) {
          const supplier = await prisma.supplier.findUnique({
            where: { name_tenantId: { name: proveedorName, tenantId } },
          });
          if (supplier) supplierId = supplier.id;
        }

        await prisma.inventoryItem.create({
          data: { imei, condition, costPrice: costo, salePrice: precioVenta, currencyCode, notes: notas, accessories: [], productId: product.id, supplierId, tenantId, tiendaId },
        });

        result.loaded++;
      } catch (err) {
        result.failed++;
        result.errors.push({ row: rowNum, reason: err.message });
      }
    }

    res.json(result);
  } catch (error) {
    console.error('[inventory:bulkUpload]', error);
    res.status(500).json({ message: 'Error procesando el archivo.' });
  }
};

module.exports = { getAll, getAlerts, getById, create, update, remove, getSuppliers, createSupplier, getProducts, getTiendas, bulkUpload };
