import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const PLAN_CONFIG = {
  STARTER: { label: 'Starter', cls: 'text-violet-600 bg-violet-50', limit: 3 },
  PRO:     { label: 'Pro',     cls: 'text-violet-700 bg-violet-100', limit: 5 },
  FULL:    { label: 'Full',    cls: 'text-fuchsia-700 bg-fuchsia-50 ring-1 ring-fuchsia-200', limit: 7 },
};

const STATUS_CONFIG = {
  ACTIVE:    { label: 'Activa',     cls: 'text-emerald-600 bg-emerald-50' },
  SUSPENDED: { label: 'Suspendida', cls: 'text-red-500 bg-red-50' },
  TRIAL:     { label: 'Trial',      cls: 'text-amber-600 bg-amber-50' },
};

const ROLE_LABELS = { OWNER: 'Owner', ADMIN: 'Admin', SELLER: 'Vendedor', TECH: 'Técnico', SUPERADMIN: 'Superadmin' };
const CURRENCY_LABELS = { USD: 'USD', PESOS: 'Pesos', USDT: 'USDT' };

const Badge = ({ config, value }) => {
  const cfg = config[value] ?? { label: value, cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const StatCard = ({ label, value }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-4 py-3.5"
    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-1.5">{label}</p>
    <p className="text-[20px] font-bold text-[#0F172A]">{value}</p>
  </div>
);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const inputCls = 'bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:border-violet-400 transition-all';

const PaymentForm = ({ tenantId, onSuccess, onCancel }) => {
  const [form, setForm] = useState({ amount: '', currency: 'USD', paidAt: new Date().toISOString().split('T')[0], notes: '' });
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) => api.post(`/admin/tenants/${tenantId}/payment`, data).then((r) => r.data),
    onSuccess: () => { setError(''); onSuccess(); },
    onError: (err) => setError(err.response?.data?.message || 'Error al registrar el pago.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({ ...form, amount: parseFloat(form.amount) });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5 mt-4">
      <p className="text-[11px] text-violet-600 uppercase tracking-widest font-medium mb-4">Registrar pago</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="sm:col-span-2">
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Monto</label>
          <input type="number" placeholder="0" value={form.amount} onChange={set('amount')} min="0.01" step="0.01" required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Moneda</label>
          <select value={form.currency} onChange={set('currency')} className={`${inputCls} w-full`}>
            <option value="USD">USD</option>
            <option value="PESOS">Pesos</option>
            <option value="USDT">USDT</option>
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Fecha</label>
          <input type="date" value={form.paidAt} onChange={set('paidAt')} required className={`${inputCls} w-full`} />
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Notas</label>
        <input type="text" placeholder="Factura, referencia, etc." value={form.notes} onChange={set('notes')} className={`${inputCls} w-full`} />
      </div>
      {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={mutation.isPending}
          className="bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-40">
          {mutation.isPending ? 'Guardando...' : 'Registrar pago'}
        </button>
        <button type="button" onClick={onCancel} className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">Cancelar</button>
      </div>
    </form>
  );
};

const ROLE_OPTIONS = [
  { value: 'OWNER',  label: 'Owner' },
  { value: 'ADMIN',  label: 'Admin' },
  { value: 'SELLER', label: 'Vendedor' },
  { value: 'TECH',   label: 'Técnico' },
];

const ALL_MODULES = [
  { key: 'inventory',   label: 'Inventario IMEI',    plan: 'STARTER' },
  { key: 'pos',         label: 'Punto de venta',      plan: 'STARTER' },
  { key: 'customers',   label: 'Clientes',            plan: 'STARTER' },
  { key: 'repairs',     label: 'Reparaciones',        plan: 'PRO',  addonPrice: 40 },
  { key: 'cash',        label: 'Caja',                plan: 'PRO',  addonPrice: 40 },
  { key: 'suppliers',   label: 'Proveedores',         plan: 'PRO',  addonPrice: 40 },
  { key: 'warranties',  label: 'Garantías',           plan: 'PRO',  addonPrice: 30 },
  { key: 'whatsapp',    label: 'WhatsApp automático', plan: 'FULL', addonPrice: 50 },
  { key: 'reports',     label: 'Reportes avanzados',  plan: 'FULL', addonPrice: 60 },
  { key: 'multibranch', label: 'Multi-sucursal',      plan: 'FULL', addonPrice: 70 },
];

const PLAN_RANK = { STARTER: 0, PRO: 1, FULL: 2 };

const PLAN_MODULES = {
  STARTER: ['inventory', 'pos', 'customers'],
  PRO:     ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties'],
  FULL:    ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties', 'whatsapp', 'reports', 'multibranch'],
};

const AddUserForm = ({ tenantId, onSuccess, onCancel }) => {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'SELLER' });
  const [err,  setErr]  = useState('');

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) => api.post(`/admin/tenants/${tenantId}/users`, data).then((r) => r.data),
    onSuccess: () => { setErr(''); onSuccess(); },
    onError: (e) => setErr(e.response?.data?.message || 'Error al crear el usuario.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setErr('');
    if (form.password.length < 6) return setErr('La contraseña debe tener al menos 6 caracteres.');
    mutation.mutate(form);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5 mt-4">
      <p className="text-[11px] text-violet-600 uppercase tracking-widest font-medium mb-4">Agregar usuario</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Nombre</label>
          <input type="text" placeholder="Nombre completo" value={form.name} onChange={set('name')} required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Email</label>
          <input type="email" placeholder="email@tienda.com" value={form.email} onChange={set('email')} required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Contraseña</label>
          <input type="password" placeholder="Mín. 6 caracteres" value={form.password} onChange={set('password')} required className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Rol</label>
          <select value={form.role} onChange={set('role')} className={`${inputCls} w-full`}>
            {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={mutation.isPending}
          className="bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-40">
          {mutation.isPending ? 'Creando...' : 'Crear usuario'}
        </button>
        <button type="button" onClick={onCancel} className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">Cancelar</button>
      </div>
    </form>
  );
};

const AdminTenantDetail = () => {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showAddUser,     setShowAddUser]     = useState(false);
  const [actionError,  setActionError]  = useState('');
  const [pendingPlan,  setPendingPlan]  = useState(null);
  const [localModules, setLocalModules] = useState(null);
  const [saveSuccess,  setSaveSuccess]  = useState(false);

  const { data: tenant, isLoading, refetch: refetchTenant } = useQuery({
    queryKey: ['admin-tenant', id],
    queryFn: () => api.get(`/admin/tenants/${id}`).then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: paymentsData } = useQuery({
    queryKey: ['admin-tenant-payments', id],
    queryFn: () => api.get(`/admin/tenants/${id}/payments`).then((r) => r.data),
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
  };

  const deleteUserMutation = useMutation({
    mutationFn: (userId) => api.delete(`/admin/tenants/${id}/users/${userId}`).then((r) => r.data),
    onSuccess: () => { setActionError(''); invalidate(); },
    onError: (err) => setActionError(err.response?.data?.message || 'Error al eliminar el usuario.'),
  });

  // Used only for status (Suspender/Activar) — plan+modules now use saveMutation
  const updateMutation = useMutation({
    mutationFn: (data) => api.put(`/admin/tenants/${id}`, data).then((r) => r.data),
    onSuccess: () => { setActionError(''); invalidate(); },
    onError: (err) => setActionError(err.response?.data?.message || 'Error al actualizar.'),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const displayModules = localModules ?? (tenant.activeModules ?? []);
      const planChanged = pendingPlan !== null && pendingPlan !== tenant.plan;
      if (planChanged) {
        // Save plan and override activeModules in one call
        return api.put(`/admin/tenants/${id}`, {
          plan: pendingPlan,
          activeModules: displayModules,
        }).then((r) => r.data);
      }
      return api.put(`/admin/tenants/${id}/modules`, { activeModules: displayModules }).then((r) => r.data);
    },
    onSuccess: () => {
      setActionError('');
      setPendingPlan(null);
      setLocalModules(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      refetchTenant();
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    },
    onError: (err) => setActionError(err.response?.data?.message || 'Error al guardar cambios.'),
  });

  const handleModuleToggle = (moduleKey) => {
    const current = localModules ?? (tenant.activeModules ?? []);
    const next = current.includes(moduleKey)
      ? current.filter((m) => m !== moduleKey)
      : [...current, moduleKey];
    setLocalModules(next);
  };

  const payments = paymentsData?.payments ?? [];
  const totalByCurrency = paymentsData?.totalByCurrency ?? {};

  if (isLoading) return <div className="px-6 pt-8 text-[#CBD5E1] text-[13px]">Cargando...</div>;

  if (!tenant) return (
    <div className="px-6 pt-8">
      <p className="text-[#94A3B8] text-[13px]">Tienda no encontrada.</p>
      <Link to="/admin" className="text-violet-600 text-[13px] mt-2 inline-block">← Volver</Link>
    </div>
  );

  const isActive = tenant.status === 'ACTIVE';

  const displayPlan    = pendingPlan ?? tenant.plan;
  const displayModules = localModules ?? (tenant.activeModules ?? []);
  const planChanged    = pendingPlan !== null && pendingPlan !== tenant.plan;
  const modulesChanged = localModules !== null &&
    [...localModules].sort().join(',') !== [...(tenant.activeModules ?? [])].sort().join(',');
  const hasChanges     = planChanged || modulesChanged;

  return (
    <div className="px-6 pt-8 pb-16 max-w-[900px] mx-auto">

      <div className="flex items-center gap-3 mb-8">
        <Link to="/admin" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Tiendas</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">{tenant.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">{tenant.name}</h1>
            <Badge config={PLAN_CONFIG} value={tenant.plan} />
            <Badge config={STATUS_CONFIG} value={tenant.status} />
          </div>
          <p className="text-[13px] text-[#94A3B8] font-mono">{tenant.slug}</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4 mb-6 grid grid-cols-2 sm:grid-cols-3 gap-4"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {[
          ['Email', tenant.email],
          ['Teléfono', tenant.phone ?? '—'],
          ['Alta', fmtDate(tenant.createdAt)],
          ['Dirección', tenant.address ?? '—'],
        ].map(([label, val]) => (
          <div key={label}>
            <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-[0.12em] mb-1">{label}</p>
            <p className="text-[13px] text-[#64748B]">{val}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Usuarios"         value={tenant._count.users} />
        <StatCard label="Stock disponible" value={tenant._count.inventoryItems} />
        <StatCard label="Ventas"           value={tenant._count.sales} />
        <StatCard label="Reparaciones"     value={tenant._count.repairOrders} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-[#94A3B8] uppercase tracking-[0.12em]">Plan</label>
          <select
            value={displayPlan}
            onChange={(e) => {
              const newPlan = e.target.value;
              if (newPlan === tenant.plan) {
                setPendingPlan(null);
                setLocalModules(null);
              } else {
                setPendingPlan(newPlan);
                setLocalModules([...PLAN_MODULES[newPlan]]);
              }
            }}
            className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-[12px] text-[#64748B]
              focus:outline-none focus:border-violet-400 transition-all"
          >
            <option value="STARTER">Starter</option>
            <option value="PRO">Pro</option>
            <option value="FULL">Full</option>
          </select>
          {planChanged && (
            <span className="text-[11px] text-amber-600 font-medium">Sin guardar</span>
          )}
        </div>

        <button
          onClick={() => updateMutation.mutate({ status: isActive ? 'SUSPENDED' : 'ACTIVE' })}
          disabled={updateMutation.isPending}
          className={`text-[12px] font-medium px-4 py-1.5 rounded-lg transition-colors disabled:opacity-40 border ${
            isActive
              ? 'bg-red-50 hover:bg-red-100 text-red-500 border-red-200'
              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border-emerald-200'
          }`}
        >
          {isActive ? 'Suspender tienda' : 'Activar tienda'}
        </button>

        <button
          onClick={() => setShowPaymentForm((v) => !v)}
          className="text-[12px] font-medium px-4 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-600 border border-violet-200 transition-colors"
        >
          + Registrar pago
        </button>
      </div>

      {showPaymentForm && (
        <PaymentForm
          tenantId={id}
          onSuccess={() => {
            setShowPaymentForm(false);
            queryClient.invalidateQueries({ queryKey: ['admin-tenant-payments', id] });
          }}
          onCancel={() => setShowPaymentForm(false)}
        />
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-violet-600 uppercase tracking-widest font-medium">Usuarios</p>
            {(() => {
              const planLimit  = PLAN_CONFIG[tenant.plan]?.limit ?? 3;
              const totalLimit = planLimit + (tenant.extraUsers ?? 0);
              const activeCount = tenant.users.filter((u) => u.isActive !== false).length;
              return (
                <span className={`text-[11px] font-medium ${activeCount >= totalLimit ? 'text-red-500' : 'text-[#94A3B8]'}`}>
                  {activeCount} / {totalLimit}
                  {tenant.extraUsers > 0 && <span className="text-[#CBD5E1]"> (+{tenant.extraUsers} add-on)</span>}
                </span>
              );
            })()}
          </div>
          <button
            onClick={() => setShowAddUser((v) => !v)}
            className="text-[12px] font-medium px-3 py-1 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-600 border border-violet-200 transition-colors"
          >
            + Agregar usuario
          </button>
        </div>

        {showAddUser && (
          <AddUserForm
            tenantId={id}
            onSuccess={() => { setShowAddUser(false); invalidate(); }}
            onCancel={() => setShowAddUser(false)}
          />
        )}

        <div className="border border-[#E2E8F0] rounded-xl overflow-hidden mt-3 bg-white"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Nombre</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Rol</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Alta</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tenant.users.map((u) => (
                <tr key={u.id} className={`border-b border-[#E2E8F0] ${u.isActive === false ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3 text-[#64748B]">{u.name}</td>
                  <td className="px-4 py-3 text-[#94A3B8] hidden sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3 text-[#94A3B8] text-[12px]">{ROLE_LABELS[u.role] ?? u.role}</td>
                  <td className="px-4 py-3 text-[#CBD5E1] text-[12px] hidden md:table-cell">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {u.role !== 'OWNER' && u.isActive !== false && (
                      <button
                        onClick={() => {
                          if (confirm(`¿Desactivar a ${u.name}?`)) deleteUserMutation.mutate(u.id);
                        }}
                        disabled={deleteUserMutation.isPending}
                        className="text-[11px] text-red-400 hover:text-red-600 transition-colors disabled:opacity-40"
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-8">
        <p className="text-[11px] text-violet-600 uppercase tracking-widest font-medium mb-3">Módulos activos</p>
        <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {ALL_MODULES.map((mod, i) => {
            const modActive = displayModules.includes(mod.key);
            const inPlan    = (PLAN_RANK[mod.plan] ?? 0) <= (PLAN_RANK[displayPlan] ?? 0);
            const isAddon   = modActive && !inPlan;
            return (
              <div
                key={mod.key}
                className={`flex items-center justify-between px-4 py-3 ${i < ALL_MODULES.length - 1 ? 'border-b border-[#E2E8F0]' : ''}`}
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-[13px] text-[#64748B]">{mod.label}</span>
                  <span className="text-[10px] text-[#CBD5E1] uppercase tracking-wide">{mod.plan.charAt(0) + mod.plan.slice(1).toLowerCase()}</span>
                  {isAddon && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200">
                      Add-on +${mod.addonPrice}/mes
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleModuleToggle(mod.key)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    modActive ? 'bg-violet-600' : 'bg-[#E2E8F0]'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    modActive ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] text-violet-600 uppercase tracking-widest font-medium">Historial de pagos</p>
          {Object.keys(totalByCurrency).length > 0 && (
            <div className="flex items-center gap-3">
              {Object.entries(totalByCurrency).map(([currency, total]) => (
                <span key={currency} className="text-[11px] text-[#94A3B8]">
                  <span className="text-[#CBD5E1]">{currency}</span>{' '}
                  <span className="text-[#64748B] font-medium">{total.toFixed(2)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {payments.length === 0 ? (
            <p className="text-center py-8 text-[#CBD5E1] text-[13px]">Sin pagos registrados.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Fecha</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Monto</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Moneda</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden sm:table-cell">Notas</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Registrado</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-[#E2E8F0]">
                    <td className="px-4 py-3 text-[#64748B]">{fmtDate(p.paidAt)}</td>
                    <td className="px-4 py-3 text-right text-[#0F172A] font-medium tabular-nums">
                      {p.amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                        {CURRENCY_LABELS[p.currency] ?? p.currency}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8] text-[12px] hidden sm:table-cell">{p.notes ?? '—'}</td>
                    <td className="px-4 py-3 text-[#CBD5E1] text-[11px] hidden md:table-cell">{fmtDateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Floating save button ── */}
      <div className="fixed bottom-6 right-6 flex items-center gap-3 z-50">
        {saveSuccess && (
          <span className="text-[12px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg shadow">
            Cambios guardados correctamente
          </span>
        )}
        {actionError && (
          <span className="text-[12px] font-medium text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg shadow">
            {actionError}
          </span>
        )}
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
          className={`px-5 py-2.5 rounded-xl text-[13px] font-semibold shadow-lg transition-all ${
            hasChanges && !saveMutation.isPending
              ? 'bg-violet-600 hover:bg-violet-700 text-white'
              : 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
          }`}
        >
          {saveMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
};

export default AdminTenantDetail;
