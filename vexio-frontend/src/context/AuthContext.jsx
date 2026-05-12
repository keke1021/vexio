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

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => readLocalStorage('vexio_user'));
  const [tenant, setTenant] = useState(() => readLocalStorage('vexio_tenant'));
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
          localStorage.setItem('vexio_tenant', JSON.stringify(updated));
          setTenant(updated);
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
    setUser(null);
    setTenant(null);
  };

  // Llamado tras un login o register exitoso
  const login = ({ accessToken, refreshToken, user, tenant }) => {
    tokenStore.setAccessToken(accessToken);
    tokenStore.setRefreshToken(refreshToken);
    localStorage.setItem('vexio_user', JSON.stringify(user));
    localStorage.setItem('vexio_tenant', JSON.stringify(tenant));
    setUser(user);
    setTenant(tenant);
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
    <AuthContext.Provider value={{ user, tenant, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
