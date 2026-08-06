import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const inputCls = 'bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:border-violet-400 transition-all';

// Alta manual de tenant desde SUPERADMIN — flujo separado del registro
// público (/register). Mismos campos que register (tenantName, tenantSlug,
// name, email, password) más maxUsers, que register no pide. La creación
// de la primera Tienda (sucursal) queda para un paso aparte, desde el
// detalle del tenant — por eso al crear acá se redirige para allá.
const CreateTenantForm = ({ onSuccess, onCancel }) => {
  const [form, setForm] = useState({
    tenantName: '', tenantSlug: '', name: '', email: '', password: '', maxUsers: '',
  });
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleTenantNameChange = (e) => {
    const tenantName = e.target.value;
    const tenantSlug = tenantName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-');
    setForm((p) => ({ ...p, tenantName, tenantSlug }));
  };

  const handleSlugChange = (e) => {
    const tenantSlug = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/--+/g, '-');
    setForm((p) => ({ ...p, tenantSlug }));
  };

  const mutation = useMutation({
    mutationFn: (data) => api.post('/admin/tenants', data).then((r) => r.data),
    onSuccess: (data) => { setErr(''); onSuccess(data.tenant); },
    onError: (e) => setErr(e.response?.data?.message || 'Error al crear el tenant.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setErr('');
    if (form.password.length < 6) return setErr('La contraseña debe tener al menos 6 caracteres.');
    mutation.mutate({ ...form, maxUsers: form.maxUsers ? parseInt(form.maxUsers, 10) : undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5 mb-6">
      <p className="text-[11px] text-violet-600 uppercase tracking-widest font-medium mb-4">Crear tenant</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Nombre del negocio</label>
          <input type="text" placeholder="Mi Tienda iPhone" value={form.tenantName} onChange={handleTenantNameChange} required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-[#94A3B8] mb-1.5 uppercase tracking-[0.1em]">ID / slug (auto)</label>
          <input type="text" placeholder="mi-tienda-iphone" value={form.tenantSlug} onChange={handleSlugChange} required className={`${inputCls} w-full font-mono`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Nombre del dueño</label>
          <input type="text" placeholder="Nombre Apellido" value={form.name} onChange={set('name')} required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Email</label>
          <input type="email" placeholder="dueño@tienda.com" value={form.email} onChange={set('email')} required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Contraseña</label>
          <input type="password" placeholder="Mín. 6 caracteres" value={form.password} onChange={set('password')} required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Usuarios máx. (opcional)</label>
          <input type="number" min="1" placeholder="7 por default" value={form.maxUsers} onChange={set('maxUsers')} className={`${inputCls} w-full`} />
        </div>
      </div>
      {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={mutation.isPending}
          className="bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-40">
          {mutation.isPending ? 'Creando...' : 'Crear tenant'}
        </button>
        <button type="button" onClick={onCancel} className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">Cancelar</button>
      </div>
    </form>
  );
};

const AdminTenants = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);

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
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-600 border border-violet-200 transition-colors"
          >
            + Crear tenant
          </button>
          <Link
            to="/admin/stats"
            className="text-[12px] text-violet-600 hover:text-violet-700 transition-colors"
          >
            Ver métricas →
          </Link>
        </div>
      </div>

      {showCreateForm && (
        <CreateTenantForm
          onSuccess={(tenant) => {
            setShowCreateForm(false);
            queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
            navigate(`/admin/tenants/${tenant.id}`);
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

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
