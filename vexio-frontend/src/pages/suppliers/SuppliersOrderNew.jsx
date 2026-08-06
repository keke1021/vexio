import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const CURRENCIES = ['ARS', 'USD', 'USDT'];

const fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtGeneric = (n, code) =>
  `${code} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

const fmtByCurrency = (n, code) => (code === 'ARS' ? fmt(n) : fmtGeneric(n, code));

const Input = ({ className = '', ...props }) => (
  <input
    className={`bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
      placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all ${className}`}
    {...props}
  />
);

const emptyItem = () => ({ description: '', quantity: '1', unitPrice: '' });

const SuppliersOrderNew = () => {
  const { id: supplierId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [items, setItems] = useState([emptyItem()]);
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [error, setError] = useState('');

  // ─── Seña opcional ────────────────────────────────────────────────────────
  // Mismo patrón de sucursal que Caja/POS: auto-preseleccionada si el tenant
  // tiene una sola, seleccionable si tiene más de una.
  const [hasDownPayment, setHasDownPayment]     = useState(false);
  const [downAmount, setDownAmount]             = useState('');
  const [downSource, setDownSource]             = useState('CASH_REGISTER');
  const [downTiendaId, setDownTiendaId]         = useState('');

  const { data: supplier } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: () => api.get(`/suppliers/${supplierId}`).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];
  const effectiveTiendaId = downTiendaId || (tiendas.length === 1 ? tiendas[0].id : '');

  const setItem = (idx, key) => (e) =>
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [key]: e.target.value } : item));

  const addItem    = () => setItems((p) => [...p, emptyItem()]);
  const removeItem = (idx) => setItems((p) => p.filter((_, i) => i !== idx));

  const total = items.reduce((s, i) => {
    const qty = parseFloat(i.quantity) || 0;
    const price = parseFloat(i.unitPrice) || 0;
    return s + qty * price;
  }, 0);

  // El pendiente se muestra calculado, nunca se tipea a mano — mismo criterio
  // que el backend (serializeOrder).
  const downAmountNum = parseFloat(downAmount) || 0;
  const pending = Math.max(total - (hasDownPayment ? downAmountNum : 0), 0);

  const mutation = useMutation({
    mutationFn: (data) => api.post(`/suppliers/${supplierId}/orders`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-orders', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate(`/suppliers/${supplierId}`);
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al crear la orden.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      currency,
      notes: notes || undefined,
      items: items.map((i) => ({
        description: i.description,
        quantity: parseInt(i.quantity),
        unitPrice: parseFloat(i.unitPrice),
      })),
      downPayment: hasDownPayment && downAmountNum > 0
        ? {
            amount: downAmountNum,
            source: downSource,
            tiendaId: downSource === 'CASH_REGISTER' ? effectiveTiendaId : undefined,
          }
        : undefined,
    });
  };

  return (
    <div className="px-6 pt-8 pb-16 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link to={`/suppliers/${supplierId}`} className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">
          ← {supplier?.name ?? 'Proveedor'}
        </Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Nueva orden</span>
      </div>

      <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A] mb-8">Nueva orden de compra</h1>

      <form onSubmit={handleSubmit} className="space-y-7">

        <section>
          <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-3">Ítems</p>

          <div className="space-y-2">
            <div className="hidden sm:grid grid-cols-[1fr_80px_130px_32px] gap-2 px-1">
              {['Descripción', 'Cant.', 'Precio unit.', ''].map((h) => (
                <p key={h} className="text-[10px] text-[#94A3B8] uppercase tracking-[0.12em]">{h}</p>
              ))}
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_80px_130px_32px] gap-2 items-center">
                <Input
                  type="text"
                  placeholder="Modelo / descripción"
                  value={item.description}
                  onChange={setItem(idx, 'description')}
                  required
                  className="w-full"
                />
                <Input
                  type="number"
                  placeholder="1"
                  value={item.quantity}
                  onChange={setItem(idx, 'quantity')}
                  min="1"
                  required
                  className="w-full text-center"
                />
                <Input
                  type="number"
                  placeholder="0"
                  value={item.unitPrice}
                  onChange={setItem(idx, 'unitPrice')}
                  min="0"
                  step="0.01"
                  required
                  className="w-full"
                />
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="text-[#CBD5E1] hover:text-red-400 transition-colors disabled:opacity-0 text-[18px] leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="mt-3 text-[12px] text-[#3B82F6] hover:text-[#2563EB] transition-colors"
          >
            + Agregar ítem
          </button>
        </section>

        <div>
          <label className="block text-[13px] font-medium text-[#64748B] mb-2">Moneda de la orden</label>
          <div className="flex gap-2">
            {CURRENCIES.map((cur) => (
              <button
                key={cur}
                type="button"
                onClick={() => setCurrency(cur)}
                className={`px-4 py-2 rounded-lg text-[12px] font-bold border transition-all ${
                  currency === cur
                    ? 'text-white border-transparent'
                    : 'bg-white border-[#E2E8F0] text-[#94A3B8] hover:text-[#64748B]'
                }`}
                style={currency === cur ? { backgroundColor: '#1E3A5F' } : {}}
              >
                {cur}
              </button>
            ))}
          </div>
        </div>

        {total > 0 && (
          <div className="flex justify-between items-center border-t border-[#E2E8F0] pt-4 text-[14px]">
            <span className="text-[#64748B]">Total</span>
            <span className="text-[#0F172A] font-bold text-[18px]">{fmtByCurrency(total, currency)}</span>
          </div>
        )}

        <section>
          <button
            type="button"
            onClick={() => setHasDownPayment((v) => !v)}
            className="text-[13px] font-medium text-[#64748B] mb-2"
          >
            {hasDownPayment ? '− Quitar seña' : '+ ¿Hay seña?'}
          </button>

          {hasDownPayment && (
            <div className="border border-[#E2E8F0] rounded-lg p-4 space-y-3 bg-[#F8FAFC]">
              <div>
                <label className="block text-[12px] font-medium text-[#64748B] mb-1.5">Monto de la seña</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={downAmount}
                  onChange={(e) => setDownAmount(e.target.value)}
                  min="0"
                  step="0.01"
                  max={total || undefined}
                  className="w-full sm:w-48"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#64748B] mb-1.5">Origen del pago</label>
                <div className="flex gap-2">
                  {[
                    { value: 'CASH_REGISTER', label: 'Caja del local' },
                    { value: 'EXTERNAL',      label: 'Cuenta externa' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDownSource(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                        downSource === opt.value
                          ? 'bg-[#3B82F6] text-white border-transparent'
                          : 'bg-white border-[#E2E8F0] text-[#94A3B8] hover:text-[#64748B]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {downSource === 'CASH_REGISTER' && (
                <div>
                  {tiendas.length > 1 ? (
                    <>
                      <label className="block text-[12px] font-medium text-[#64748B] mb-1.5">Sucursal</label>
                      <select
                        value={effectiveTiendaId}
                        onChange={(e) => setDownTiendaId(e.target.value)}
                        className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
                          focus:outline-none focus:border-[#3B82F6] transition-all"
                      >
                        <option value="">Seleccioná una sucursal</option>
                        {tiendas.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </>
                  ) : tiendas.length === 0 ? (
                    <p className="text-[12px] text-amber-600">
                      No hay ninguna sucursal creada — no se puede pagar desde caja.
                    </p>
                  ) : null}
                </div>
              )}

              {downAmountNum > 0 && (
                <p className="text-[12px] text-[#94A3B8] pt-1">
                  Pendiente luego de la seña: <span className="font-medium text-[#64748B]">{fmtByCurrency(pending, currency)}</span>
                </p>
              )}
            </div>
          )}
        </section>

        <section>
          <label className="block text-[13px] font-medium text-[#64748B] mb-2">
            Notas (opcional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Condiciones de pago, observaciones..."
            rows={2}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
              placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all resize-none"
          />
        </section>

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={
              mutation.isPending ||
              (hasDownPayment && downAmountNum > 0 && downSource === 'CASH_REGISTER' && !effectiveTiendaId)
            }
            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-6 py-2.5
              rounded-lg transition-colors disabled:opacity-40"
          >
            {mutation.isPending ? 'Creando...' : 'Crear orden'}
          </button>
          <Link to={`/suppliers/${supplierId}`} className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
};

export default SuppliersOrderNew;
