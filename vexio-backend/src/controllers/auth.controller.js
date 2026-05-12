const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const PLAN_MODULES = {
  STARTER: ['inventory', 'pos', 'customers'],
  PRO:     ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties'],
  FULL:    ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties', 'whatsapp', 'reports', 'multibranch'],
};

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

// --- Controladores ---

/**
 * POST /api/auth/register
 * Registra una nueva tienda (Tenant) y crea el usuario OWNER.
 */
const register = async (req, res) => {
  try {
    const { tenantName, tenantSlug, email, password, name } = req.body;

    if (!tenantName || !tenantSlug || !email || !password || !name) {
      return res.status(400).json({ message: 'Todos los campos son requeridos.' });
    }

    const existingTenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (existingTenant) {
      return res.status(409).json({ message: 'El slug de tienda ya está en uso.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const { tenant, user } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug: tenantSlug,
          email,
          activeModules: PLAN_MODULES.STARTER,
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          role: 'OWNER',
          tenantId: tenant.id,
        },
      });

      return { tenant, user };
    });

    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId: tenant.id,
      role: user.role,
    });

    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: getRefreshTokenExpiry() },
    });

    return res.status(201).json({
      message: 'Tienda registrada exitosamente.',
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, activeModules: tenant.activeModules ?? [] },
    });
  } catch (error) {
    console.error('[register]', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
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

    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId: tenant?.id ?? user.tenantId,
      role: user.role,
    });

    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: getRefreshTokenExpiry() },
    });

    return res.status(200).json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenant: tenant
        ? { id: tenant.id, name: tenant.name, slug: tenant.slug, activeModules: tenant.activeModules ?? [] }
        : { id: user.tenantId, name: 'Admin', slug: 'admin', activeModules: [] },
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

    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    const tenantData = user.tenant
      ? { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug, activeModules: user.tenant.activeModules ?? [] }
      : null;

    return res.status(200).json({ accessToken, tenant: tenantData });
  } catch (error) {
    console.error('[refresh]', error);
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

module.exports = { register, login, logout, refresh, changePassword };
