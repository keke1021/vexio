import { useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

const NAV = [
  { path: '/dashboard',  label: 'Inicio',           exact: true,  module: null },
  { path: '/inventory',  label: 'Inventario',        exact: false, module: 'inventory' },
  { path: '/pos',        label: 'Punto de Venta',    exact: false, module: 'pos' },
  { path: '/repairs',    label: 'Reparaciones',      exact: false, module: 'repairs' },
  { path: '/cash',       label: 'Caja',              exact: false, module: 'cash' },
  { path: '/suppliers',  label: 'Proveedores',       exact: false, module: 'suppliers' },
  { path: '/tickets',    label: 'Soporte',           exact: false, module: null },
];

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
              <p className="text-center py-8 text-[12px] text-[#CBD5E1]">Sin notificaciones nuevas</p>
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
                  <p className="text-[10px] text-[#CBD5E1] mt-0.5">{fmtTime(n.createdAt)}</p>
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

const Layout = () => {
  const { user, tenant, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeModules = tenant?.activeModules ?? [];

  const isActive = (item) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

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
      <header className="px-6 h-14 flex items-center justify-between shrink-0 print:hidden"
        style={{ backgroundColor: '#1E3A5F', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
        <div className="flex items-center gap-5">
          <span className="text-[15px] font-bold tracking-tight select-none text-white">Vexio</span>
          <span className="text-white/20">|</span>
          <nav className="flex items-center gap-0.5">
            {NAV.filter((item) => item.module === null || activeModules.includes(item.module)).map((item) => {
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
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
