import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';

const PLAN_CONFIG = {
  STARTER: { label: 'Starter', cls: 'text-violet-600 bg-violet-50' },
  PRO:     { label: 'Pro',     cls: 'text-violet-700 bg-violet-100' },
  FULL:    { label: 'Full',    cls: 'text-fuchsia-700 bg-fuchsia-50 ring-1 ring-fuchsia-200' },
};

const STATUS_CONFIG = {
  ACTIVE:    { label: 'Activa',     cls: 'text-emerald-600 bg-emerald-50' },
  SUSPENDED: { label: 'Suspendida', cls: 'text-red-500 bg-red-50' },
  TRIAL:     { label: 'Trial',      cls: 'text-amber-600 bg-amber-50' },
};

const PlanBadge = ({ plan }) => {
  const cfg = PLAN_CONFIG[plan] ?? { label: plan, cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const AdminTenants = () => {
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: () => api.get('/admin/tenants').then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  });

  const errDetail = error?.response?.data?.detail
    || (error?.response?.data?.roleRecibido ? `Role en token: "${error.response.data.roleRecibido}" — ${error.response.data.message}` : null)
    || error?.response?.data?.message
    || (error?.response?.status ? `HTTP ${error.response.status}` : null)
    || error?.message
    || 'Error desconocido';

  const tenants = data?.tenants ?? [];

  const byStatus = tenants.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="px-6 pt-8 pb-16 max-w-[1100px] mx-auto">

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Tiendas</h1>
          <p className="text-[13px] text-[#94A3B8] mt-0.5">
            {isLoading ? '...' : (
              <>
                {tenants.length} tiendas
                {byStatus.ACTIVE    ? <span className="ml-2 text-emerald-600">{byStatus.ACTIVE} activas</span>    : null}
                {byStatus.SUSPENDED ? <span className="ml-2 text-red-500">{byStatus.SUSPENDED} suspendidas</span> : null}
                {byStatus.TRIAL     ? <span className="ml-2 text-amber-600">{byStatus.TRIAL} en trial</span>      : null}
              </>
            )}
          </p>
        </div>
        <Link
          to="/admin/stats"
          className="text-[12px] text-violet-600 hover:text-violet-700 transition-colors"
        >
          Ver métricas →
        </Link>
      </div>

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Tienda</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Slug</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Plan</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Estado</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Usuarios</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Stock</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Vencimiento</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden xl:table-cell">Alta</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="text-center py-16 text-[#CBD5E1]">Cargando...</td></tr>
            )}
            {isError && (
              <tr>
                <td colSpan={8} className="text-center py-10">
                  <p className="text-red-500 text-[13px] font-medium mb-1">Error al cargar tiendas</p>
                  <p className="text-[11px] text-[#94A3B8] font-mono">{errDetail}</p>
                </td>
              </tr>
            )}
            {!isLoading && tenants.length === 0 && (
              <tr><td colSpan={8} className="text-center py-16 text-[#CBD5E1]">Sin tiendas registradas.</td></tr>
            )}
            {tenants.map((t) => (
              <tr
                key={t.id}
                onClick={() => navigate(`/admin/tenants/${t.id}`)}
                className="border-b border-[#E2E8F0] hover:bg-violet-50 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3.5">
                  <p className="text-[#0F172A] font-medium">{t.name}</p>
                  <p className="text-[#94A3B8] text-[11px]">{t.email}</p>
                </td>
                <td className="px-4 py-3.5 text-[#94A3B8] font-mono text-[12px] hidden sm:table-cell">{t.slug}</td>
                <td className="px-4 py-3.5"><PlanBadge plan={t.plan} /></td>
                <td className="px-4 py-3.5"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3.5 text-right text-[#94A3B8] hidden md:table-cell">{t._count.users}</td>
                <td className="px-4 py-3.5 text-right text-[#94A3B8] hidden lg:table-cell">{t._count.inventoryItems}</td>
                <td className="px-4 py-3.5 text-[#94A3B8] text-[12px] hidden lg:table-cell">{t.subscriptionEndsAt ? fmtDate(t.subscriptionEndsAt) : '—'}</td>
                <td className="px-4 py-3.5 text-[#CBD5E1] text-[12px] hidden xl:table-cell">{fmtDate(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminTenants;
