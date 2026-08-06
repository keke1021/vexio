import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const PAYMENT_OPTIONS = [
  { value: 'CASH',         label: 'Efectivo' },
  { value: 'TRANSFER',     label: 'Transferencia' },
  { value: 'CARD',         label: 'Tarjeta' },
  { value: 'INSTALLMENTS', label: 'Cuotas' },
];

const Label = ({ children, required }) => (
  <label className="block text-[13px] font-medium text-[#64748B] mb-2">
    {children}{required && <span className="text-[#3B82F6] ml-1">*</span>}
  </label>
);

const Input = ({ className = '', ...props }) => (
  <input
    className={`w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
      placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all ${className}`}
    {...props}
  />
);

const CashMovementNew = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [form, setForm] = useState({
    type: 'INCOME',
    amount: '',
    description: '',
    paymentMethod: 'CASH',
    currencyCode: 'ARS',
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  // tiendaId normalmente ya viene en la URL (el link "+ Nuevo" de CashMain
  // lo manda) — pero si se entra directo a esta pantalla (bookmark, back
  // button) lo resolvemos igual acá: auto-preseleccionado si el tenant
  // tiene una sola sucursal, selector si tiene más de una.
  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];
  const tiendaIdParam = searchParams.get('tiendaId') || '';
  const tiendaId = tiendaIdParam || (tiendas.length === 1 ? tiendas[0].id : '');
  const tiendaActual = tiendas.find((t) => t.id === tiendaId);

  useEffect(() => {
    if (!tiendaIdParam && tiendas.length === 1) {
      setSearchParams({ tiendaId: tiendas[0].id }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiendas.length, tiendaIdParam]);

  const mutation = useMutation({
    mutationFn: (data) => api.post('/cash/movements', data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      // Mismo motivo que en CashMain.jsx (invalidate()): el "Balance final"
      // de la sesión abierta en el historial embebido de /cash sale de
      // GET /cash/sessions — sin esto quedaba desactualizado hasta el
      // staleTime (30s) o una recarga después de cargar un movimiento manual.
      queryClient.invalidateQueries({ queryKey: ['cash-sessions'] });
      navigate('/cash');
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al registrar el movimiento.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      ...form,
      amount: parseFloat(form.amount),
      tiendaId,
    });
  };

  return (
    <div className="px-6 pt-8 pb-16 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link to="/cash" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">← Caja</Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Nuevo movimiento</span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mb-8">Registrar movimiento</h1>

      {tiendas.length === 0 && (
        <p className="text-[13px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
          Todavía no hay ninguna sucursal creada — hace falta al menos una para poder registrar movimientos.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {tiendas.length > 1 && (
          <div>
            <Label required>Sucursal</Label>
            <select
              value={tiendaId}
              onChange={(e) => setSearchParams({ tiendaId: e.target.value })}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#64748B]
                focus:outline-none focus:border-[#3B82F6] transition-all"
            >
              <option value="">Seleccioná una sucursal</option>
              {tiendas.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {tiendas.length === 1 && tiendaActual && (
          <p className="text-[12px] text-[#94A3B8]">Sucursal: <span className="text-[#64748B] font-medium">{tiendaActual.name}</span></p>
        )}

        <div>
          <Label required>Tipo</Label>
          <div className="flex gap-3">
            {[
              { value: 'INCOME',  label: 'Ingreso',  active: 'border-emerald-400 bg-emerald-50 text-emerald-600', inactive: 'border-[#E2E8F0] bg-white text-[#94A3B8]' },
              { value: 'EXPENSE', label: 'Egreso',   active: 'border-red-400 bg-red-50 text-red-500', inactive: 'border-[#E2E8F0] bg-white text-[#94A3B8]' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm((p) => ({ ...p, type: opt.value }))}
                className={`flex-1 py-2.5 rounded-lg border text-[13px] font-medium transition-all ${
                  form.type === opt.value ? opt.active : opt.inactive + ' hover:text-[#64748B]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label required>Monto</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="0"
              value={form.amount}
              onChange={set('amount')}
              min="0.01"
              step="0.01"
              required
              className="flex-1"
            />
            <div className="flex gap-1">
              {['ARS', 'USD', 'USDT'].map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, currencyCode: cur }))}
                  className={`px-3 py-2 rounded-lg text-[12px] font-bold border transition-all ${
                    form.currencyCode === cur
                      ? 'text-white border-transparent'
                      : 'bg-white border-[#E2E8F0] text-[#94A3B8] hover:text-[#64748B]'
                  }`}
                  style={form.currencyCode === cur ? { backgroundColor: '#1E3A5F' } : {}}
                >
                  {cur}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <Label required>Descripción</Label>
          <Input
            type="text"
            placeholder={form.type === 'INCOME' ? 'Ej: Cobro de seña' : 'Ej: Pago proveedor repuestos'}
            value={form.description}
            onChange={set('description')}
            required
          />
        </div>

        <div>
          <Label required>Medio de pago</Label>
          <select
            value={form.paymentMethod}
            onChange={set('paymentMethod')}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#64748B]
              focus:outline-none focus:border-[#3B82F6] transition-all"
          >
            {PAYMENT_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending || !tiendaId}
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-6 py-2.5
              rounded-lg transition-colors disabled:opacity-40"
          >
            {mutation.isPending ? 'Guardando...' : 'Registrar'}
          </button>
          <Link to="/cash" className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">Cancelar</Link>
        </div>
      </form>
    </div>
  );
};

export default CashMovementNew;
