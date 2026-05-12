import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  const [form, setForm] = useState({
    type: 'INCOME',
    amount: '',
    description: '',
    paymentMethod: 'CASH',
    currency: 'ARS',
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (data) => api.post('/cash/movements', data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
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

      <form onSubmit={handleSubmit} className="space-y-6">

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
              {['ARS', 'USD'].map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, currency: cur }))}
                  className={`px-3 py-2 rounded-lg text-[12px] font-bold border transition-all ${
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
            disabled={mutation.isPending}
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
