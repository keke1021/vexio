import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';

const fmtDateShort = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const PLAN_CONFIG = {
  STARTER: { label: 'Starter', cls: 'text-violet-600 bg-violet-50', mrr: 19 },
  PRO:     { label: 'Pro',     cls: 'text-violet-700 bg-violet-100', mrr: 39 },
  FULL:    { label: 'Full',    cls: 'text-fuchsia-700 bg-fuchsia-50 ring-1 ring-fuchsia-200', mrr: 69 },
};

const STATUS_CONFIG = {
  ACTIVE:    { label: 'Activas',     cls: 'text-emerald-600' },
  SUSPENDED: { label: 'Suspendidas', cls: 'text-red-500' },
  TRIAL:     { label: 'Trial',       cls: 'text-amber-600' },
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const StatCard = ({ label, value, sub, accent }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.15em] mb-2">{label}</p>
    <p className={`text-[26px] font-bold tracking-tight ${accent ?? 'text-[#0F172A]'}`}>{value}</p>
    {sub && <p className="text-[11px] text-[#94A3B8] mt-1">{sub}</p>}
  </div>
);

const AdminStats = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: expiringData } = useQuery({
    queryKey: ['admin-expiring'],
    queryFn: () => api.get('/admin/tenants/expiring').then((r) => r.data),
    staleTime: 60_000,
  });

  const expiring = expiringData?.tenants ?? [];

  if (isLoading) return <div className="px-6 pt-8 text-[#CBD5E1] text-[13px]">Cargando...</div>;

  const byStatus = data?.byStatus ?? {};
  const byPlan   = data?.byPlan ?? {};

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-center gap-3 mb-8">
        <Link to="/admin" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Tiendas</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Métricas</span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mb-8">Métricas globales</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard
          label="MRR estimado"
          value={`$${data?.mrr ?? 0}`}
          sub="USD/mes · tiendas activas"
          accent="text-violet-700"
        />
        <StatCard label="Total tiendas"  value={data?.totalTenants ?? 0} />
        <StatCard label="Tiendas activas" value={data?.activeTenants ?? 0} accent="text-emerald-600" />
        <StatCard label="Stock total" value={data?.totalItems ?? 0} sub="equipos disponibles" />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-5 mb-6"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-4">Por estado</p>
        <div className="flex gap-8">
          {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
            <div key={status}>
              <p className="text-[11px] text-[#94A3B8] mb-0.5">{cfg.label}</p>
              <p className={`text-[28px] font-bold ${cfg.cls}`}>{byStatus[status] ?? 0}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-5 mb-8"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-4">Por plan</p>
        <div className="grid grid-cols-3 gap-5">
          {Object.entries(PLAN_CONFIG).map(([plan, cfg]) => {
            const count = byPlan[plan] ?? 0;
            return (
              <div key={plan} className={`rounded-xl border px-4 py-4 ${
                plan === 'FULL' ? 'border-fuchsia-200 bg-fuchsia-50' :
                plan === 'PRO'  ? 'border-violet-200 bg-violet-50' :
                'border-[#E2E8F0] bg-[#F8FAFC]'
              }`}>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium mb-3 ${cfg.cls}`}>
                  {cfg.label}
                </span>
                <p className="text-[32px] font-bold text-[#0F172A]">{count}</p>
                <p className="text-[11px] text-[#94A3B8] mt-1">
                  ${cfg.mrr * count}/mes · ${cfg.mrr}/u
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <StatCard label="Ventas totales"      value={data?.totalSales ?? 0}   sub="en todo el sistema" />
        <StatCard label="Reparaciones totales" value={data?.totalRepairs ?? 0} sub="en todo el sistema" />
      </div>

      {expiring.length > 0 && (
        <div className="mb-8">
          <p className="text-[11px] text-amber-600 uppercase tracking-widest font-medium mb-3">
            Vencimientos próximos (7 días)
          </p>
          <div className="border border-amber-200 rounded-xl overflow-hidden bg-amber-50"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <table className="w-full text-[13px]">
              <tbody>
                {expiring.map((t) => {
                  const daysLeft = Math.ceil((new Date(t.subscriptionEndsAt) - new Date()) / (1000 * 60 * 60 * 24));
                  return (
                    <tr key={t.id} className="border-b border-amber-100 last:border-0">
                      <td className="px-4 py-3">
                        <Link to={`/admin/tenants/${t.id}`} className="text-[#64748B] hover:text-[#0F172A] transition-colors">
                          {t.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${PLAN_CONFIG[t.plan]?.cls ?? ''}`}>
                          {PLAN_CONFIG[t.plan]?.label ?? t.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-[12px] font-medium tabular-nums ${daysLeft <= 2 ? 'text-red-500' : 'text-amber-600'}`}>
                          {daysLeft <= 0 ? 'Vencido' : `${daysLeft}d`}
                        </span>
                        <span className="text-[11px] text-[#CBD5E1] ml-2">{fmtDateShort(t.subscriptionEndsAt)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data?.recentTenants?.length > 0 && (
        <div>
          <p className="text-[11px] text-violet-600 uppercase tracking-widest font-medium mb-3">
            Últimas tiendas registradas
          </p>
          <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <table className="w-full text-[13px]">
              <tbody>
                {data.recentTenants.map((t) => (
                  <tr key={t.id} className="border-b border-[#E2E8F0] last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/tenants/${t.id}`}
                        className="text-[#64748B] hover:text-[#0F172A] transition-colors"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${PLAN_CONFIG[t.plan]?.cls ?? ''}`}>
                        {PLAN_CONFIG[t.plan]?.label ?? t.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#CBD5E1] text-[12px] text-right">{fmtDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminStats;
