const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// --- Helpers ---

const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
};

const generateRefreshToken = () => crypto.randomBytes(64).toString('hex');

const getRefreshTokenExpiry = () => {
  const days = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '7', 10);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

/**
 * Sucursales entre las que este usuario puede elegir como "sucursal activa".
 *   - SUPERADMIN            → [] (no está sujeto a scope por sucursal).
 *   - SELLER / TECH         → [su sucursal asignada]  (o [] si no tiene una).
 *   - OWNER / ADMIN         → todas las Tienda del tenant.
 * Devuelve [{ id, name }] ordenado por nombre.
 */
const resolveAvailableTiendas = async (user) => {
  if (user.role === 'SUPERADMIN') return [];
  if (user.role === 'SELLER' || user.role === 'TECH') {
    if (!user.tiendaId) return [];
    const t = await prisma.tienda.findFirst({
      where: { id: user.tiendaId, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    return t ? [t] : [];
  }
  return prisma.tienda.findMany({
    where: { tenantId: user.tenantId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
};

// --- Controladores ---

/**
 * POST /api/auth/register
 * DESHABILITADO — decisión de negocio (2026-08-06): el registro público de
 * tenants queda cerrado. Ezequiel es el único que crea cuentas de clientes,
 * siempre desde el panel de Admin (POST /api/admin/tenants → createTenant,
 * admin.controller.js), que llama a createTenantWithOwner
 * (utils/tenantOnboarding.js) directamente — ese helper compartido sigue
 * intacto y funcionando, solo se cerró esta puerta de entrada pública.
 */
const register = async (req, res) => {
  return res.status(403).json({
    message: 'El registro público está deshabilitado, contactá al administrador.',
  });
};

/**
 * POST /api/auth/login
 * Autentica un usuario por email y contraseña (sin requerir slug de tienda).
 * Si hay múltiples usuarios con el mismo email, usa el primero activo encontrado.
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }

    const users = await prisma.user.findMany({
      where: { email, isActive: true },
      include: { tenant: true },
    });

    if (!users.length) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    // Prefer SUPERADMIN if multiple users share the same email across tenants
    const user = users.find((u) => u.role === 'SUPERADMIN') ?? users[0];

    if (user.role !== 'SUPERADMIN' && !user.tenant?.isActive) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const tenant = user.tenant;

    // Sucursal activa de la sesión. Si el usuario tiene una sola sucursal
    // posible (SELLER/TECH con su asignada, u OWNER/ADMIN de un tenant con una
    // sola Tienda) se elige automáticamente — sin pantalla extra. Si tiene
    // varias (OWNER/ADMIN multi-sucursal), queda null: el frontend le pide
    // elegir antes de entrar al resto de la app (sin default silencioso), vía
    // POST /auth/select-tienda.
    const availableTiendas = await resolveAvailableTiendas(user);
    const activeTiendaId = availableTiendas.length === 1 ? availableTiendas[0].id : null;

    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId: tenant?.id ?? user.tenantId,
      role: user.role,
      tiendaId: activeTiendaId,
    });

    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: getRefreshTokenExpiry(), activeTiendaId },
    });

    return res.status(200).json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, tiendaId: user.tiendaId },
      tenant: tenant
        ? { id: tenant.id, name: tenant.name, slug: tenant.slug, activeModules: tenant.activeModules ?? [] }
        : { id: user.tenantId, name: 'Admin', slug: 'admin', activeModules: [] },
      // Sucursal activa ya resuelta ({id,name}) o null si hay que elegir.
      activeTienda: activeTiendaId ? availableTiendas.find((t) => t.id === activeTiendaId) : null,
      // Lista para el selector (login multi-sucursal y cambio de sucursal).
      availableTiendas,
    });
  } catch (error) {
    console.error('[login]', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/auth/logout
 * Revoca el refresh token, invalidando la sesión activa.
 */
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token requerido.' });
    }

    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });

    return res.status(200).json({ message: 'Sesión cerrada exitosamente.' });
  } catch (error) {
    console.error('[logout]', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/auth/refresh
 * Emite un nuevo access token si el refresh token es válido y no expiró.
 */
const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token requerido.' });
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { include: { tenant: true } } },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      if (storedToken) {
        await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      }
      return res.status(401).json({ message: 'Refresh token inválido o expirado.' });
    }

    const { user } = storedToken;

    if (!user.isActive || (user.role !== 'SUPERADMIN' && !user.tenant.isActive)) {
      return res.status(401).json({ message: 'La cuenta o la tienda están inactivas.' });
    }

    // Sucursal activa de esta sesión: la que quedó guardada en la fila del
    // refresh token (elegida en login/select-tienda). Se re-valida contra las
    // sucursales disponibles ahora — si la sucursal se borró, o al usuario le
    // reasignaron otra, se recalcula (y se persiste el cambio).
    const availableTiendas = await resolveAvailableTiendas(user);
    let activeTiendaId = storedToken.activeTiendaId;
    if (activeTiendaId && !availableTiendas.some((t) => t.id === activeTiendaId)) {
      activeTiendaId = null;
    }
    if (!activeTiendaId && availableTiendas.length === 1) {
      activeTiendaId = availableTiendas[0].id;
    }
    if (activeTiendaId !== storedToken.activeTiendaId) {
      await prisma.refreshToken.update({ where: { id: storedToken.id }, data: { activeTiendaId } });
    }

    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      tiendaId: activeTiendaId,
    });

    const tenantData = user.tenant
      ? { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug, activeModules: user.tenant.activeModules ?? [] }
      : null;

    return res.status(200).json({
      accessToken,
      tenant: tenantData,
      activeTienda: activeTiendaId ? availableTiendas.find((t) => t.id === activeTiendaId) : null,
      availableTiendas,
    });
  } catch (error) {
    console.error('[refresh]', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/auth/select-tienda
 * Body: { refreshToken, tiendaId }
 * Fija la sucursal activa de la sesión. Sirve para la selección inicial
 * (OWNER/ADMIN multi-sucursal, tras el login) y para CAMBIAR de sucursal
 * después. Valida que la sucursal esté entre las disponibles del usuario
 * (un SELLER pidiendo otra sucursal → 403). Persiste la elección en la fila
 * del refresh token y devuelve un access token nuevo scopeado a esa sucursal.
 * El frontend hace un reload completo tras un cambio para que todo cargue
 * limpio.
 */
const selectTienda = async (req, res) => {
  try {
    const { refreshToken, tiendaId } = req.body;

    if (!refreshToken || !tiendaId) {
      return res.status(400).json({ message: 'refreshToken y tiendaId son requeridos.' });
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: { include: { tenant: true } } },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      return res.status(401).json({ message: 'Sesión inválida o expirada.' });
    }

    const { user } = storedToken;
    if (!user.isActive || (user.role !== 'SUPERADMIN' && !user.tenant.isActive)) {
      return res.status(401).json({ message: 'La cuenta o la tienda están inactivas.' });
    }

    const availableTiendas = await resolveAvailableTiendas(user);
    const match = availableTiendas.find((t) => t.id === tiendaId);
    if (!match) {
      return res.status(403).json({ message: 'No tenés acceso a esa sucursal.' });
    }

    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { activeTiendaId: tiendaId },
    });

    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      tiendaId,
    });

    return res.status(200).json({ accessToken, activeTienda: match, availableTiendas });
  } catch (error) {
    console.error('[selectTienda]', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/auth/password
 * Cambia la contraseña del usuario autenticado.
 */
const changePassword = async (req, res) => {
  try {
    const { userId } = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Contraseña actual y nueva son requeridas.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ message: 'La contraseña actual es incorrecta.' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });

    res.json({ message: 'Contraseña actualizada exitosamente.' });
  } catch (error) {
    console.error('[changePassword]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { register, login, logout, refresh, selectTienda, changePassword };
