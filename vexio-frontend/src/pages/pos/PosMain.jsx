import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const PAYMENT_METHODS = [
  { value: 'CASH',         label: 'Efectivo'      },
  { value: 'TRANSFER',     label: 'Transferencia' },
  { value: 'CARD',         label: 'Tarjeta'       },
  { value: 'INSTALLMENTS', label: 'Cuotas'        },
];

const formatCurrency = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

const formatRate = (n) =>
  n != null ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n) : '—';

// ─── Result Card ──────────────────────────────────────────────────────────────

const ResultCard = ({ item, onAdd, inCart }) => (
  <button
    onClick={() => onAdd(item)}
    disabled={inCart}
    className={`w-full text-left border rounded-xl p-4 transition-all ${
      inCart
        ? 'border-[#E2E8F0] bg-[#F8FAFC] opacity-40 cursor-not-allowed'
        : 'border-[#E2E8F0] bg-white hover:border-[#3B82F6]/50 hover:bg-[#EFF6FF] cursor-pointer'
    }`}
    style={{ boxShadow: inCart ? 'none' : '0 1px 3px rgba(0,0,0,0.04)' }}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-[#0F172A] truncate">
          {item.product.name} · {item.product.color} · {item.product.storage}
        </p>
        <p className="font-mono text-[11px] text-[#94A3B8] mt-0.5">{item.imei}</p>
        {item.supplier && (
          <p className="text-[11px] text-[#CBD5E1] mt-1">{item.supplier.name}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-[15px] font-bold text-[#0F172A]">{formatCurrency(item.salePrice)}</p>
        <p className="text-[11px] text-[#94A3B8] mt-0.5">{item.margin?.toFixed(1)}% margen</p>
      </div>
    </div>
    {inCart && (
      <p className="mt-2 text-[11px] text-[#3B82F6]">Ya está en el carrito</p>
    )}
  </button>
);

// ─── Cart Item ────────────────────────────────────────────────────────────────

const CartItem = ({ entry, onRemove }) => (
  <div className="flex items-center justify-between gap-3 py-3 border-b border-[#E2E8F0] last:border-0">
    <div className="min-w-0">
      <p className="text-[13px] text-[#0F172A] truncate">
        {entry.item.product.name} {entry.item.product.storage}
      </p>
      <p className="font-mono text-[11px] text-[#94A3B8] mt-0.5">{entry.item.imei}</p>
    </div>
    <div className="flex items-center gap-3 shrink-0">
      <span className="text-[13px] font-medium text-[#64748B]">{formatCurrency(entry.salePrice)}</span>
      <button
        onClick={() => onRemove(entry.item.id)}
        className="text-[#CBD5E1] hover:text-red-400 transition-colors text-[16px] leading-none"
        title="Quitar"
      >
        ×
      </button>
    </div>
  </div>
);

// ─── Rates Widget ─────────────────────────────────────────────────────────────

const RatesWidget = ({ onRateSelect, selectedRate, selectedType }) => {
  const [expanded, setExpanded] = useState(false);
  const [usdAmount, setUsdAmount] = useState('');

  const { data: rates } = useQuery({
    queryKey:        ['rates'],
    queryFn:         () => api.get('/rates').then((r) => r.data),
    staleTime:       5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    throwOnError:    false,
  });

  const blue = rates?.blue;
  const usdt = rates?.usdt;

  const blueArs = usdAmount ? Math.round(parseFloat(usdAmount) * (blue?.sell ?? 0)) : null;
  const usdtArs = usdAmount ? Math.round(parseFloat(usdAmount) * (usdt?.price ?? 0)) : null;

  const fmtTs = (ts) => ts
    ? new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="border-t border-white/10" style={{ backgroundColor: '#1E3A5F' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-4">
          {blue?.sell && (
            <span className="text-[11px] text-white/70">
              Blue <span className="text-white font-medium">${formatRate(blue.sell)}</span>
            </span>
          )}
          {usdt?.price && (
            <span className="text-[11px] text-white/70">
              USDT <span className="text-white font-medium">${formatRate(usdt.price)}</span>
            </span>
          )}
          {!blue?.sell && !usdt?.price && (
            <span className="text-[11px] text-white/40">Cotizaciones no disponibles</span>
          )}
        </div>
        <span className="text-[11px] text-white/50">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-wider mb-1.5">Calculadora USD → ARS</p>
            <input
              type="number"
              placeholder="Monto en USD"
              value={usdAmount}
              onChange={(e) => setUsdAmount(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2
                text-[13px] text-white placeholder-white/30 focus:outline-none focus:border-white/50 transition-colors"
            />
            {usdAmount && (
              <div className="mt-2 space-y-1">
                {blueArs != null && blue?.sell && (
                  <p className="text-[12px] text-white/70">
                    Blue (venta): <span className="text-white font-medium">{formatCurrency(blueArs)}</span>
                  </p>
                )}
                {usdtArs != null && usdt?.price && (
                  <p className="text-[12px] text-white/70">
                    USDT: <span className="text-white font-medium">{formatCurrency(usdtArs)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-wider mb-1.5">Tipo de cambio para la venta</p>
            <div className="flex gap-2">
              {[
                { type: 'BLUE', rate: blue?.sell,  label: 'Blue' },
                { type: 'USDT', rate: usdt?.price, label: 'USDT' },
                { type: 'NONE', rate: null,         label: 'Ninguno' },
              ].map(({ type, rate, label }) => (
                <button
                  key={type}
                  onClick={() => onRateSelect(type, rate)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    selectedType === type
                      ? 'bg-white text-[#1E3A5F]'
                      : 'bg-white/10 text-white/75 hover:bg-white/20 border border-white/20'
                  }`}
                >
                  {label}
                  {rate && <span className="block text-[10px] opacity-70">${formatRate(rate)}</span>}
                </button>
              ))}
            </div>
          </div>

          {rates?.updatedAt && (
            <p className="text-[10px] text-white/30">
              Actualizado {fmtTs(rates.updatedAt)}{rates.stale ? ' (caché)' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const PosMain = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const searchRef = useRef(null);

  const [search, setSearch]           = useState('');
  const [debouncedQ, setDebouncedQ]   = useState('');
  const [cart, setCart]               = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [saleCurrency, setSaleCurrency]   = useState('ARS');
  const [customerName, setCustomerName]   = useState('');
  const [showCustomer, setShowCustomer]   = useState(false);
  const [saleError, setSaleError]         = useState('');
  const [exchangeType, setExchangeType]   = useState('NONE');
  const [exchangeRate, setExchangeRate]   = useState(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    if (/^\d{15}$/.test(search)) { setDebouncedQ(search); return; }
    const t = setTimeout(() => setDebouncedQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: searchData, isFetching } = useQuery({
    queryKey: ['pos-search', debouncedQ],
    queryFn:  () => api.get('/pos/search-item', { params: { q: debouncedQ } }).then((r) => r.data),
    enabled:  debouncedQ.trim().length >= 2,
    staleTime: 10_000,
  });

  const results = searchData?.items ?? [];
  const cartIds = new Set(cart.map((c) => c.item.id));

  useEffect(() => {
    if (!searchData || !search) return;
    if (/^\d{15}$/.test(search) && results.length === 1 && !cartIds.has(results[0].id)) {
      addToCart(results[0]);
      setSearch('');
      setDebouncedQ('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchData]);

  const addToCart    = (item) => {
    if (cartIds.has(item.id)) return;
    setCart((prev) => [...prev, { item, salePrice: item.salePrice }]);
  };
  const removeFromCart = (itemId) => setCart((prev) => prev.filter((c) => c.item.id !== itemId));

  const total      = cart.reduce((sum, c) => sum + c.salePrice, 0);
  const canConfirm = cart.length > 0 && paymentMethod;

  const saleMutation = useMutation({
    mutationFn: (data) => api.post('/pos/sales', data).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['pos-sales'] });
      navigate(`/pos/sales/${data.id}`);
    },
    onError: (err) => setSaleError(err.response?.data?.message || 'Error al procesar la venta.'),
  });

  const handleConfirm = () => {
    setSaleError('');
    saleMutation.mutate({
      items: cart.map((c) => ({ inventoryItemId: c.item.id, salePrice: c.salePrice })),
      paymentMethod,
      currency: saleCurrency,
      customerName:  customerName || undefined,
      exchangeType:  exchangeType !== 'NONE' ? exchangeType : undefined,
      exchangeRate:  exchangeRate ?? undefined,
    });
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && results.length === 1 && !cartIds.has(results[0].id)) {
      addToCart(results[0]);
      setSearch('');
      setDebouncedQ('');
    }
    if (e.key === 'Escape') { setSearch(''); setDebouncedQ(''); }
  };

  const handleRateSelect = (type, rate) => {
    setExchangeType(type);
    setExchangeRate(rate ?? null);
  };

  return (
    <div className="flex h-[calc(100vh-56px)]">

      {/* ── Panel izquierdo: búsqueda + resultados + rates ── */}
      <div className="flex-1 flex flex-col border-r border-[#E2E8F0] overflow-hidden">

        <div className="p-5 border-b border-[#E2E8F0] bg-white">
          <div className="relative">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Escanear IMEI o buscar modelo..."
              className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-5 py-3.5 text-[14px] text-[#0F172A]
                placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] font-mono transition-all"
            />
            {isFetching && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-[#E2E8F0] border-t-[#3B82F6] animate-spin" />
            )}
          </div>
          <p className="mt-2 text-[11px] text-[#CBD5E1]">
            Ingresá el IMEI con el lector · <kbd className="text-[#94A3B8]">Enter</kbd> para agregar · <kbd className="text-[#94A3B8]">Esc</kbd> para limpiar
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {debouncedQ.length >= 2 && !isFetching && results.length === 0 && (
            <p className="text-center py-12 text-[13px] text-[#CBD5E1]">
              No hay equipos disponibles para &ldquo;{debouncedQ}&rdquo;
            </p>
          )}
          {results.map((item) => (
            <ResultCard key={item.id} item={item} onAdd={addToCart} inCart={cartIds.has(item.id)} />
          ))}
          {!debouncedQ && (
            <div className="flex flex-col items-center justify-center h-full py-20 text-center">
              <p className="text-[13px] text-[#CBD5E1]">Buscá o escaneá un equipo para comenzar</p>
            </div>
          )}
        </div>

        <RatesWidget
          onRateSelect={handleRateSelect}
          selectedType={exchangeType}
          selectedRate={exchangeRate}
        />
      </div>

      {/* ── Panel derecho: carrito ── */}
      <div className="w-80 xl:w-96 flex flex-col" style={{ backgroundColor: '#F0F4F8' }}>

        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-white">
          <h2 className="text-[14px] font-semibold text-[#0F172A]">
            Carrito {cart.length > 0 && <span className="text-[#3B82F6]">({cart.length})</span>}
          </h2>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-[11px] text-[#94A3B8] hover:text-red-400 transition-colors">
              Limpiar
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 bg-white">
          {cart.length === 0 ? (
            <p className="text-center py-12 text-[12px] text-[#CBD5E1]">El carrito está vacío</p>
          ) : (
            cart.map((entry) => (
              <CartItem key={entry.item.id} entry={entry} onRemove={removeFromCart} />
            ))
          )}
        </div>

        <div className="border-t border-[#E2E8F0] px-5 py-5 space-y-4 bg-white"
          style={{ boxShadow: '0 -1px 4px rgba(0,0,0,0.04)' }}>

          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-[#94A3B8] uppercase tracking-wider">Total</span>
            <span className="text-[24px] font-bold text-[#0F172A]">{formatCurrency(total)}</span>
          </div>

          {exchangeType !== 'NONE' && exchangeRate && (
            <p className="text-[11px] text-[#64748B]">
              {exchangeType === 'BLUE' ? 'Dólar blue' : 'USDT'}: ${exchangeRate?.toFixed(0)}/USD
            </p>
          )}

          <div>
            <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider mb-2">Medio de pago</p>
            <div className="grid grid-cols-2 gap-1.5">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.value}
                  onClick={() => setPaymentMethod(pm.value)}
                  className={`py-2 rounded-lg text-[12px] font-medium transition-all ${
                    paymentMethod === pm.value
                      ? 'bg-[#3B82F6] text-white'
                      : 'bg-[#F8FAFC] text-[#64748B] hover:bg-[#EFF6FF] hover:text-[#0F172A] border border-[#E2E8F0]'
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider mb-2">Moneda de la venta</p>
            <div className="flex gap-1.5">
              {['ARS', 'USD', 'USDT'].map((cur) => (
                <button
                  key={cur}
                  onClick={() => setSaleCurrency(cur)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                    saleCurrency === cur
                      ? 'text-white'
                      : 'bg-[#E8EEF4] text-[#64748B] hover:bg-[#DDE5EE]'
                  }`}
                  style={saleCurrency === cur ? { backgroundColor: '#1E3A5F' } : {}}
                >
                  {cur}
                </button>
              ))}
            </div>
            {(saleCurrency === 'USD' || saleCurrency === 'USDT') && exchangeRate && (
              <p className="mt-1.5 text-[11px] text-[#64748B]">
                Cambio: ${Math.round(exchangeRate).toLocaleString('es-AR')} por {saleCurrency}
              </p>
            )}
          </div>

          <div>
            <button
              onClick={() => setShowCustomer(!showCustomer)}
              className="text-[11px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
            >
              {showCustomer ? '↑ Ocultar' : '+ Agregar'} cliente
            </button>
            {showCustomer && (
              <input
                type="text"
                placeholder="Nombre del cliente"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-2 w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
                  placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-all"
              />
            )}
          </div>

          {saleError && <p className="text-[12px] text-red-500">{saleError}</p>}

          <button
            onClick={handleConfirm}
            disabled={!canConfirm || saleMutation.isPending}
            className={`w-full py-3.5 rounded-xl text-[14px] font-bold transition-all ${
              canConfirm && !saleMutation.isPending
                ? 'bg-[#3B82F6] hover:bg-[#2563EB] text-white'
                : 'bg-[#F1F5F9] text-[#CBD5E1] cursor-not-allowed'
            }`}
          >
            {saleMutation.isPending ? 'Procesando...' : 'Confirmar venta'}
          </button>

          <Link
            to="/pos/sales"
            className="block text-center text-[12px] text-[#94A3B8] hover:text-[#64748B] transition-colors"
          >
            Ver historial →
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PosMain;
