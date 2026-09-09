import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../api/axios';
import SyntraFooter from './SyntraFooter';
import { filterNav } from '../config/access';

const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const TYPE_COLORS = {
  INFO:    'text-[#3B82F6]',
  WARNING: 'text-amber-500',
  DANGER:  'text-red-500',
};

// ─── Notification Bell ────────────────────────────────────────────────────────

const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey:        ['notifications'],
    queryFn:         () => api.get('/notifications').then((r) => r.data),
    staleTime:       60_000,
    refetchInterval: 60_000,
    throwOnError:    false,
  });

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOne = useMutation({
    mutationFn: (id) => api.put(`/notifications/${id}/read`),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications = data?.notifications ?? [];
  const count         = data?.count ?? 0;

  const fmtTime = (d) =>
    new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 text-white/75 hover:text-white transition-colors"
        title="Notificaciones"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center
            rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-80 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0]">
            <p className="text-[12px] font-medium text-[#64748B]">Notificaciones</p>
            {count > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="text-[11px] text-[#3B82F6] hover:text-[#2563EB] transition-colors"
              >
                Marcar todas leídas
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-center py-8 text-[12px] text-[#64748B]">Sin notificaciones nuevas</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markOne.mutate(n.id)}
                  className="w-full text-left px-4 py-3 border-b border-[#E2E8F0] hover:bg-[#EFF6FF] transition-colors"
                >
                  <p className={`text-[12px] font-medium ${TYPE_COLORS[n.type] ?? 'text-[#64748B]'}`}>
                    {n.message}
                  </p>
                  <p className="text-[10px] text-[#64748B] mt-0.5">{fmtTime(n.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Layout ───────────────────────────────────────────────────────────────────

// Selector / indicador de sucursal activa en el header.
//   - OWNER/ADMIN con >1 sucursal: <select> para cambiar. Al cambiar se pide un
//     JWT nuevo scopeado a esa sucursal y se recarga toda la app (así React
//     Query, formularios y todo arrancan limpios con los datos de la nueva).
//   - resto (SELLER/TECH, o 1 sola sucursal): chip de solo lectura.
const BranchSwitcher = () => {
  const { activeTienda, availableTiendas, selectTienda } = useAuth();
  const [switching, setSwitching] = useState(false);

  if (!activeTienda) return null;

  const canSwitch = (availableTiendas?.length ?? 0) > 1;

  if (!canSwitch) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 text-white/90 text-[11px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-white/50" />
        {activeTienda.name}
      </span>
    );
  }

  const onChange = async (e) => {
    const id = e.target.value;
    if (id === activeTienda.id) return;
    setSwitching(true);
    try {
      await selectTienda(id);
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  };

  return (
    <select
      value={activeTienda.id}
      onChange={onChange}
      disabled={switching}
      title="Sucursal activa"
      className="bg-white/10 text-white text-[11px] font-medium rounded-md px-2 py-1 border border-white/15
        focus:outline-none focus:border-white/40 transition-colors disabled:opacity-50 max-w-[140px]"
    >
      {availableTiendas.map((t) => (
        <option key={t.id} value={t.id} className="text-[#0F172A]">{t.name}</option>
      ))}
    </select>
  );
};

const Layout = () => {
  const { user, tenant, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const activeModules = tenant?.activeModules ?? [];
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (item) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  const visibleNav = filterNav(user?.role, activeModules);

  // Cerrar el menú mobile al navegar
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const { data: repairStats } = useQuery({
    queryKey:     ['repairs-stats'],
    queryFn:      () => api.get('/repairs/stats').then((r) => r.data),
    staleTime:    60_000,
    throwOnError: false,
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      <header className="relative z-50 px-6 h-14 flex items-center justify-between shrink-0 print:hidden"
        style={{ backgroundColor: '#1E3A5F', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
        <div className="flex items-center gap-5">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden p-1.5 -ml-1.5 text-white/75 hover:text-white transition-colors"
            title="Menú"
            aria-label="Menú"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          <span className="text-[15px] font-bold tracking-tight select-none text-white">Vexio</span>
          <span className="hidden md:inline text-white/20">|</span>
          <nav className="hidden md:flex items-center gap-0.5">
            {visibleNav.map((item) => {
              const active = isActive(item);
              const badge  = item.path === '/repairs' && repairStats?.active > 0
                ? repairStats.active
                : null;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`relative px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    active
                      ? 'text-white bg-white/15'
                      : 'text-white/75 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {item.label}
                  {badge && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1
                      rounded-full bg-[#3B82F6]/20 text-[#3B82F6] text-[10px] font-bold leading-none">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="p-1.5 text-white/75 hover:text-white transition-colors"
            title={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <BranchSwitcher />
          <NotificationBell />
          <div className="text-right hidden sm:block">
            <p className="text-[12px] text-white leading-none">{tenant?.name}</p>
            <Link to="/settings/password" className="text-[11px] text-white/75 mt-0.5 hover:text-white transition-colors block">
              {user?.name}
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="text-[12px] text-white/75 hover:text-white transition-colors"
          >
            Salir
          </button>
        </div>
        {menuOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 top-14 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <nav
              className="md:hidden absolute top-full left-0 right-0 z-50 py-2 print:hidden"
              style={{ backgroundColor: '#1E3A5F', boxShadow: '0 6px 16px rgba(0,0,0,0.25)' }}
            >
              {visibleNav.map((item) => {
                const active = isActive(item);
                const badge  = item.path === '/repairs' && repairStats?.active > 0
                  ? repairStats.active
                  : null;

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMenuOpen(false)}
                    className={`relative flex items-center px-6 py-3 text-[14px] font-medium transition-colors ${
                      active
                        ? 'text-white bg-white/15'
                        : 'text-white/75 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                    {badge && (
                      <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1
                        rounded-full bg-[#3B82F6]/20 text-[#3B82F6] text-[10px] font-bold leading-none">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <SyntraFooter />
    </div>
  );
};

export default Layout;
