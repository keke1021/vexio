import { createContext, useContext, useState, useEffect } from 'react';
import api, { tokenStore } from '../api/axios';

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
};

// Lectura segura de JSON desde localStorage
const readLocalStorage = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};

const writeLocalStorage = (key, value) => {
  if (value == null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => readLocalStorage('vexio_user'));
  const [tenant, setTenant] = useState(() => readLocalStorage('vexio_tenant'));
  // Sucursal activa de la sesión ({ id, name }) — null mientras un OWNER/ADMIN
  // multi-sucursal no eligió. `availableTiendas`: opciones para el selector.
  const [activeTienda, setActiveTienda] = useState(() => readLocalStorage('vexio_active_tienda'));
  const [availableTiendas, setAvailableTiendas] = useState(() => readLocalStorage('vexio_available_tiendas') ?? []);
  // `loading` es true mientras verificamos si el refresh token guardado sigue siendo válido
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const refreshToken = tokenStore.getRefreshToken();

      // Si no hay refresh token o no hay datos de usuario, no hay sesión activa
      if (!refreshToken || !user) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await api.post('/auth/refresh', { refreshToken });
        tokenStore.setAccessToken(data.accessToken);
        // Sync activeModules in case admin changed them since last login
        if (data.tenant) {
          const updated = { ...readLocalStorage('vexio_tenant'), ...data.tenant };
          writeLocalStorage('vexio_tenant', updated);
          setTenant(updated);
        }
        // La sucursal activa / disponibles vienen re-validadas por el backend
        // (si se borró la sucursal o reasignaron al usuario, ya vienen
        // corregidas).
        if ('activeTienda' in data) {
          writeLocalStorage('vexio_active_tienda', data.activeTienda ?? null);
          setActiveTienda(data.activeTienda ?? null);
        }
        if (Array.isArray(data.availableTiendas)) {
          writeLocalStorage('vexio_available_tiendas', data.availableTiendas);
          setAvailableTiendas(data.availableTiendas);
        }
      } catch {
        // El refresh token expiró o fue revocado: limpiar sesión
        _clearSession();
      } finally {
        setLoading(false);
      }
    };

    initAuth();
    // Solo se ejecuta al montar la app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const _clearSession = () => {
    tokenStore.clear();
    localStorage.removeItem('vexio_user');
    localStorage.removeItem('vexio_tenant');
    localStorage.removeItem('vexio_active_tienda');
    localStorage.removeItem('vexio_available_tiendas');
    setUser(null);
    setTenant(null);
    setActiveTienda(null);
    setAvailableTiendas([]);
  };

  // Llamado tras un login exitoso
  const login = ({ accessToken, refreshToken, user, tenant, activeTienda: at, availableTiendas: avt }) => {
    tokenStore.setAccessToken(accessToken);
    tokenStore.setRefreshToken(refreshToken);
    writeLocalStorage('vexio_user', user);
    writeLocalStorage('vexio_tenant', tenant);
    writeLocalStorage('vexio_active_tienda', at ?? null);
    writeLocalStorage('vexio_available_tiendas', avt ?? []);
    setUser(user);
    setTenant(tenant);
    setActiveTienda(at ?? null);
    setAvailableTiendas(avt ?? []);
  };

  // Elegir / cambiar la sucursal activa de la sesión. Pide un access token
  // nuevo scopeado a esa sucursal y lo persiste (el backend guarda la elección
  // en la fila del refresh token, así el próximo refresh ya viene con ella).
  // Devuelve la sucursal elegida; el caller decide si recargar la app.
  const selectTienda = async (tiendaId) => {
    const refreshToken = tokenStore.getRefreshToken();
    const { data } = await api.post('/auth/select-tienda', { refreshToken, tiendaId });
    tokenStore.setAccessToken(data.accessToken);
    writeLocalStorage('vexio_active_tienda', data.activeTienda);
    setActiveTienda(data.activeTienda);
    if (Array.isArray(data.availableTiendas)) {
      writeLocalStorage('vexio_available_tiendas', data.availableTiendas);
      setAvailableTiendas(data.availableTiendas);
    }
    return data.activeTienda;
  };

  const logout = async () => {
    try {
      const rt = tokenStore.getRefreshToken();
      if (rt) await api.post('/auth/logout', { refreshToken: rt });
    } catch {
      // Si el servidor falla, igual limpiamos el estado local
    } finally {
      _clearSession();
    }
  };

  return (
    <AuthContext.Provider value={{ user, tenant, activeTienda, availableTiendas, loading, login, logout, selectTienda }}>
      {children}
    </AuthContext.Provider>
  );
};
