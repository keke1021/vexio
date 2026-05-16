import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const STORAGE_OPTIONS = ['64GB', '128GB', '256GB', '512GB', '1TB'];
const CONDITION_OPTIONS = [
  { value: 'NEW', label: 'Nuevo (sellado)' },
  { value: 'LIKE_NEW', label: 'Como nuevo' },
  { value: 'REFURBISHED', label: 'Reacondicionado' },
  { value: 'USED', label: 'Usado' },
];
const COMMON_ACCESSORIES = ['Caja original', 'Cable USB-C', 'Cargador 20W', 'EarPods', 'Adaptador Lightning'];

const calcMargin = (cost, sale) => {
  const c = parseFloat(cost);
  const s = parseFloat(sale);
  if (!s || s === 0) return null;
  return (((s - c) / s) * 100).toFixed(1);
};

const getMarginStyle = (m) => {
  if (m === null) return { color: 'text-[#CBD5E1]', label: '—' };
  const n = parseFloat(m);
  if (n >= 30) return { color: 'text-emerald-600', label: `${m}%` };
  if (n >= 10) return { color: 'text-yellow-600', label: `${m}%` };
  return { color: 'text-red-500', label: `${m}% — margen bajo` };
};

const Label = ({ children }) => (
  <label className="block text-[13px] font-medium text-[#64748B] mb-2">
    {children}
  </label>
);

const Input = ({ className = '', ...props }) => (
  <input
    className={`w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
      placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all ${className}`}
    {...props}
  />
);

const Select = ({ children, ...props }) => (
  <select
    className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#64748B]
      focus:outline-none focus:border-[#3B82F6] transition-all"
    {...props}
  >
    {children}
  </select>
);

const InventoryNew = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const imeiRef = useRef(null);

  const [form, setForm] = useState({
    productName: '',
    color: '',
    storage: '128GB',
    imei: '',
    condition: 'NEW',
    costPrice: '',
    currency: 'ARS',
    salePrice: '',
    supplierId: '',
    accessories: [],
    notes: '',
  });
  const [error, setError] = useState('');
  const [imeiError, setImeiError] = useState('');

  useEffect(() => {
    imeiRef.current?.focus();
  }, []);

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    if (key === 'imei') setImeiError('');
  };

  const toggleAccessory = (acc) => {
    setForm((prev) => ({
      ...prev,
      accessories: prev.accessories.includes(acc)
        ? prev.accessories.filter((a) => a !== acc)
        : [...prev.accessories, acc],
    }));
  };

  const validateImei = (value) => {
    if (value && !/^\d{15}$/.test(value)) {
      setImeiError('El IMEI debe tener exactamente 15 dígitos.');
      return false;
    }
    return true;
  };

  const margin = calcMargin(form.costPrice, form.salePrice);
  const marginStyle = getMarginStyle(margin);

  const mutation = useMutation({
    mutationFn: (data) => api.post('/inventory', data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      navigate('/inventory');
    },
    onError: (err) => {
      setError(err.response?.data?.message || 'Error al guardar el equipo.');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!validateImei(form.imei)) return;
    mutation.mutate({
      ...form,
      costPrice: parseFloat(form.costPrice),
      salePrice: parseFloat(form.salePrice),
    });
  };

  return (
    <div className="px-6 pt-8 pb-16 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link to="/inventory" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">
          ← Inventario
        </Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Nuevo equipo</span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mb-8">Agregar equipo</h1>

      <form onSubmit={handleSubmit} className="space-y-7">

        <div>
          <Label>IMEI</Label>
          <div className="relative">
            <Input
              ref={imeiRef}
              type="text"
              placeholder="Apuntá el lector acá o ingresalo manualmente"
              value={form.imei}
              onChange={set('imei')}
              onBlur={(e) => validateImei(e.target.value)}
              className="font-mono pr-20"
              maxLength={15}
              required
            />
            {form.imei && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#CBD5E1]">
                {form.imei.length}/15
              </span>
            )}
          </div>
          {imeiError && <p className="mt-1.5 text-[12px] text-red-500">{imeiError}</p>}
        </div>

        <div>
          <Label>Modelo</Label>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <div className="flex-1 min-w-0">
              <Input
                type="text"
                placeholder="iPhone 15 Pro"
                value={form.productName}
                onChange={set('productName')}
                required
              />
              <p className="mt-1 text-[11px] text-[#CBD5E1]">Nombre del modelo</p>
            </div>
            <div className="flex-1 min-w-0">
              <Input
                type="text"
                placeholder="Natural Titanium"
                value={form.color}
                onChange={set('color')}
                required
              />
              <p className="mt-1 text-[11px] text-[#CBD5E1]">Color</p>
            </div>
            <div className="flex-1 min-w-0">
              <div className="relative">
                <select
                  value={form.storage}
                  onChange={set('storage')}
                  className="w-full appearance-none bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 pr-8
                    text-[13px] text-[#64748B] focus:outline-none focus:border-[#3B82F6] transition-all"
                >
                  {STORAGE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#94A3B8]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[#CBD5E1]">Storage</p>
            </div>
          </div>
        </div>

        <div>
          <Label>Condición</Label>
          <Select value={form.condition} onChange={set('condition')}>
            {CONDITION_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label>Precios</Label>
          <div className="flex gap-1.5 mb-3">
            {['ARS', 'USD'].map((cur) => (
              <button
                key={cur}
                type="button"
                onClick={() => setForm((p) => ({ ...p, currency: cur }))}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-all ${
                  form.currency === cur
                    ? 'text-white border-transparent'
                    : 'bg-white border-[#E2E8F0] text-[#94A3B8] hover:text-[#64748B]'
                }`}
                style={form.currency === cur ? { backgroundColor: '#1E3A5F' } : {}}
              >
                {cur}
              </button>
            ))}
          </div>
          <div className="flex flex-row gap-4">
            <div className="flex-1 min-w-0">
              <Input
                type="number"
                placeholder="0"
                value={form.costPrice}
                onChange={set('costPrice')}
                min="0"
                step="0.01"
                required
              />
              <p className="mt-1 text-[11px] text-[#CBD5E1]">Costo ({form.currency})</p>
            </div>
            <div className="flex-1 min-w-0">
              <Input
                type="number"
                placeholder="0"
                value={form.salePrice}
                onChange={set('salePrice')}
                min="0"
                step="0.01"
                required
              />
              <p className="mt-1 text-[11px] text-[#CBD5E1]">Precio de venta ({form.currency})</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-[#94A3B8] uppercase tracking-wider">Margen:</span>
            <span className={`text-[14px] font-bold transition-colors ${marginStyle.color}`}>
              {marginStyle.label}
            </span>
          </div>
        </div>

        <div>
          <Label>Proveedor</Label>
          <Select value={form.supplierId} onChange={set('supplierId')}>
            <option value="">Sin proveedor</option>
            {suppliersData?.suppliers?.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label>Accesorios incluidos</Label>
          <div className="flex flex-wrap gap-2">
            {COMMON_ACCESSORIES.map((acc) => {
              const active = form.accessories.includes(acc);
              return (
                <button
                  key={acc}
                  type="button"
                  onClick={() => toggleAccessory(acc)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                    active
                      ? 'border-[#3B82F6] bg-[#EFF6FF] text-[#3B82F6]'
                      : 'border-[#E2E8F0] bg-white text-[#94A3B8] hover:border-[#3B82F6]/40'
                  }`}
                >
                  {active ? '✓ ' : ''}{acc}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Notas internas</Label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Observaciones, estado de la batería, daños cosméticos..."
            rows={3}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all resize-none"
          />
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-6 py-2.5
              rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Guardando...' : 'Guardar equipo'}
          </button>
          <Link
            to="/inventory"
            className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
};

export default InventoryNew;
