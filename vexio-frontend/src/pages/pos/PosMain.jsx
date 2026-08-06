import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

const PAYMENT_METHODS = [
  { value: 'CASH',         label: 'Efectivo'      },
  { value: 'TRANSFER',     label: 'Transferencia' },
  { value: 'CARD',         label: 'Tarjeta'       },
  { value: 'INSTALLMENTS', label: 'Cuotas'        },
];

const formatCurrency = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const fmtGeneric = (n, code) =>
  `${code} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

const fmtByCurrency = (n, cur) => (cur === 'ARS' ? formatCurrency(n) : fmtGeneric(n, cur));

const formatRate = (n) =>
  n != null ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n) : '—';

// ─── Conversión (preview del carrito — el backend es la fuente de verdad) ─────
//
// Antes esta fórmula estaba duplicada acá y en pos.controller.js, y encima
// usaba la cotización del dólar blue tanto para USD como para USDT. Ahora
// hay una sola función, con la misma lógica que src/services/
// exchangeRates.service.js del backend (no se puede compartir el archivo
// literal entre los dos proyectos — son dos apps node separadas sin paquete
// compartido — pero es la misma fórmula, documentada igual). Esto es solo
// para mostrarle un precio estimado al vendedor en el carrito: la venta se
// recalcula siempre en el backend con la cotización real del momento, este
// resultado nunca se manda como si fuera el precio final.
//
// 1 unidad de `from` = ? unidades de `to`.
const resolveRate = (rates, from, to) => {
  if (from === to) return 1;
  const arsPerUnit = { USD: rates?.blue?.sell ?? null, USDT: rates?.usdt?.price ?? null };
  if (from === 'ARS') {
    const arsPerTo = arsPerUnit[to];
    return arsPerTo ? 1 / arsPerTo : null;
  }
  if (to === 'ARS') return arsPerUnit[from] ?? null;
  const a = arsPerUnit[from];
  const b = arsPerUnit[to];
  return (a && b) ? a / b : null;
};

// ─── Icons ────────────────────────────────────────────────────────────────────

const PencilIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

// ─── Result Card ──────────────────────────────────────────────────────────────

const ResultCard = ({ item, onAdd, inCart, rates }) => {
  const cur = item.currencyCode ?? 'ARS';
  const isARS = cur === 'ARS';
  const primaryFmt = fmtByCurrency(item.salePrice, cur);

  // Línea secundaria: precio en la "otra" moneda de referencia (ARS si el
  // item está en USD/USDT, USD si el item está en ARS), con la tasa real
  // del par correspondiente — ya no asume blue para todo lo que no sea ARS.
  const otherCur = isARS ? 'USD' : 'ARS';
  const rate = resolveRate(rates, cur, otherCur);
  const dualLine = rate ? `${primaryFmt} · ${fmtByCurrency(item.salePrice * rate, otherCur)}` : null;

  return (
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
          <p className="text-[15px] font-bold text-[#0F172A]">{primaryFmt}</p>
          {dualLine && (
            <p className="text-[11px] text-[#94A3B8] mt-0.5">{dualLine}</p>
          )}
          <p className="text-[11px] text-[#94A3B8] mt-0.5">{item.margin?.toFixed(1)}% margen</p>
        </div>
      </div>
      {inCart && (
        <p className="mt-2 text-[11px] text-[#3B82F6]">Ya está en el carrito</p>
      )}
    </button>
  );
};

// ─── Cart Item ────────────────────────────────────────────────────────────────

const CartItem = ({ entry, displayPrice, currency, onRemove, onSetPrice }) => {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setInputVal(currency === 'ARS' ? Math.round(displayPrice).toString() : displayPrice.toFixed(2));
    setEditing(true);
  };

  const confirmEdit = () => {
    const val = parseFloat(inputVal);
    if (!isNaN(val) && val >= 0) onSetPrice(entry.item.id, val);
    setEditing(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-[#E2E8F0] last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] text-[#0F172A] truncate">
          {entry.item.product.name} {entry.item.product.storage}
        </p>
        <p className="font-mono text-[11px] text-[#94A3B8] mt-0.5">{entry.item.imei}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={confirmEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-24 bg-white border border-[#3B82F6] rounded-md px-2 py-1
              text-[12px] text-[#0F172A] focus:outline-none tabular-nums"
          />
        ) : (
          <>
            <span className={`text-[13px] font-medium ${
              entry.manualPrice !== null ? 'text-amber-500' : 'text-[#64748B]'
            }`}>
              {fmtByCurrency(displayPrice, currency)}
            </span>
            <button
              onClick={startEdit}
              className="text-[#CBD5E1] hover:text-[#64748B] transition-colors"
              title="Editar precio"
            >
              <PencilIcon />
            </button>
          </>
        )}
        <button
          onClick={() => onRemove(entry.item.id)}
          className="text-[#CBD5E1] hover:text-red-400 transition-colors text-[16px] leading-none ml-1"
          title="Quitar"
        >
          ×
        </button>
      </div>
    </div>
  );
};

// ─── Rates Widget ─────────────────────────────────────────────────────────────
// Solo muestra la cotización en vivo y una calculadora de referencia. Ya no
// tiene selector "Tipo de cambio para la venta" (BLUE/USDT/NONE) — el
// backend elige automáticamente el par correcto según la moneda de la
// venta, no hace falta que el vendedor lo indique a mano.

const RatesWidget = ({ rates }) => {
  const [expanded, setExpanded] = useState(false);
  const [usdAmount, setUsdAmount] = useState('');

  const blue = rates?.blue;
  const usdt = rates?.usdt;

  const blueArs = usdAmount ? Math.round(parseFloat(usdAmount) * (blue?.sell ?? 0)) : null;
  const usdtArs = usdAmount ? Math.round(parseFloat(usdAmount) * (usdt?.price ?? 0)) : null;

  const fmtTs = (ts) =>
    ts ? new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null;

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

  const [search, setSearch]               = useState('');
  const [debouncedQ, setDebouncedQ]       = useState('');
  const [cart, setCart]                   = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [saleCurrency, setSaleCurrency]   = useState('ARS');
  const [customerName, setCustomerName]   = useState('');
  const [showCustomer, setShowCustomer]   = useState(false);
  const [saleError, setSaleError]         = useState('');

  // Toda venta pertenece a una sucursal (igual que Caja) — tiendaId viaja en
  // la URL para poder compartirse/refrescarse, auto-preseleccionada si el
  // tenant tiene una sola tienda, seleccionable si tiene más de una. Mismo
  // patrón que CashMain.jsx.
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];
  const tiendaIdParam = searchParams.get('tiendaId') || '';
  const tiendaId = tiendaIdParam || (tiendas.length === 1 ? tiendas[0].id : '');

  useEffect(() => {
    if (!tiendaIdParam && tiendas.length === 1) {
      setSearchParams({ tiendaId: tiendas[0].id }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiendas.length, tiendaIdParam]);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    if (/^\d{15}$/.test(search)) { setDebouncedQ(search); return; }
    const t = setTimeout(() => setDebouncedQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ─── Rates (hoisted so PosMain can auto-convert prices) ───────────────────
  const { data: rates } = useQuery({
    queryKey:        ['rates'],
    queryFn:         () => api.get('/rates').then((r) => r.data),
    staleTime:       5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    throwOnError:    false,
  });

  // Tasa relevante para la moneda de venta actual (solo para el aviso de
  // "cotización no disponible" y el pie de página del total) — el precio
  // real de cada item usa su propio par vía resolveRate.
  const activeRate = saleCurrency !== 'ARS' ? resolveRate(rates, saleCurrency, 'ARS') : null;

  // ─── Price helpers ────────────────────────────────────────────────────────
  // cart entry: { item, baseSalePrice (en item.currencyCode), manualPrice (null | number en saleCurrency) }
  const getDisplayPrice = (entry) => {
    if (entry.manualPrice !== null) return entry.manualPrice;
    const itemCurrency = entry.item.currencyCode ?? 'ARS';
    const price = entry.baseSalePrice;
    if (itemCurrency === saleCurrency) return price;
    const rate = resolveRate(rates, itemCurrency, saleCurrency);
    if (!rate) return price;
    return saleCurrency === 'ARS' ? Math.round(price * rate) : parseFloat((price * rate).toFixed(2));
  };

  // ─── Search ───────────────────────────────────────────────────────────────
  const { data: searchData, isFetching } = useQuery({
    queryKey:  ['pos-search', debouncedQ],
    queryFn:   () => api.get('/pos/search-item', { params: { q: debouncedQ } }).then((r) => r.data),
    enabled:   debouncedQ.trim().length >= 2,
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

  // ─── Cart actions ─────────────────────────────────────────────────────────
  const addToCart = (item) => {
    if (cartIds.has(item.id)) return;
    setCart((prev) => [...prev, { item, baseSalePrice: item.salePrice, manualPrice: null }]);
  };

  const removeFromCart = (itemId) =>
    setCart((prev) => prev.filter((c) => c.item.id !== itemId));

  const setItemPrice = (itemId, price) =>
    setCart((prev) => prev.map((e) => e.item.id === itemId ? { ...e, manualPrice: price } : e));

  const handleCurrencyChange = (cur) => {
    setSaleCurrency(cur);
    setCart((prev) => prev.map((e) => ({ ...e, manualPrice: null })));
  };

  const total      = cart.reduce((sum, c) => sum + getDisplayPrice(c), 0);
  const canConfirm = cart.length > 0 && paymentMethod && !!tiendaId;
  const noRateWarn = saleCurrency !== 'ARS' && !activeRate;

  // ─── Sale mutation ────────────────────────────────────────────────────────
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
    // El precio que se manda es el editado a mano en el carrito (si lo hay)
    // o el estimado localmente — el backend jamás lo toma como definitivo,
    // recalcula todo con la cotización real del momento. No se manda
    // exchangeRate/exchangeType: el backend los resuelve solo.
    saleMutation.mutate({
      items:        cart.map((c) => ({ inventoryItemId: c.item.id, salePrice: getDisplayPrice(c) })),
      paymentMethod,
      currency:     saleCurrency,
      customerName: customerName || undefined,
      tiendaId,
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

  return (
    <div className="h-[calc(100vh-56px)] bg-[#F8FAFC]">
      {/* max-w-6xl + mx-auto centra el conjunto en monitores anchos — antes
          el buscador pegaba a la izquierda y dejaba un solo bloque de
          espacio vacío grande y descompensado del lado derecho. */}
      <div className="flex items-start h-full max-w-6xl mx-auto">

      {/* ── Panel izquierdo: búsqueda + resultados + rates ──
          self-stretch mantiene su alto completo (con scroll interno de
          resultados) igual que antes; flex-1 ahora está acotado por el
          max-w-6xl del contenedor — antes crecía sin límite hasta el borde
          de la pantalla en monitores anchos. */}
      <div className="flex-1 self-stretch flex flex-col border-r border-[#E2E8F0] overflow-hidden bg-white">

        <div className="p-5 border-b border-[#E2E8F0] bg-white">
          {tiendas.length > 1 && (
            <div className="mb-3">
              <label className="text-[10px] text-[#94A3B8] uppercase tracking-[0.12em] mr-2">Sucursal</label>
              <select
                value={tiendaId}
                onChange={(e) => setSearchParams({ tiendaId: e.target.value })}
                className="bg-white border border-[#E2E8F0] rounded-lg px-2 py-1 text-[13px] text-[#0F172A]
                  focus:outline-none focus:border-[#3B82F6] transition-all"
              >
                <option value="">Seleccioná una sucursal</option>
                {tiendas.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          {tiendas.length === 0 && (
            <p className="mb-3 text-[12px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Todavía no hay ninguna sucursal creada — hace falta al menos una para poder vender.
            </p>
          )}
          {tiendas.length > 1 && !tiendaId && (
            <p className="mb-3 text-[12px] text-[#94A3B8]">Elegí una sucursal arriba para poder vender.</p>
          )}
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
            <ResultCard key={item.id} item={item} onAdd={addToCart} inCart={cartIds.has(item.id)} rates={rates} />
          ))}
          {!debouncedQ && (
            <div className="flex flex-col items-center justify-center h-full py-20 text-center">
              <p className="text-[13px] text-[#CBD5E1]">Buscá o escaneá un equipo para comenzar</p>
            </div>
          )}
        </div>

        <RatesWidget rates={rates} />
      </div>

      {/* ── Panel derecho: carrito — alto natural según su contenido, no
          forzado a llenar el viewport (antes "flex-1" lo estiraba a la
          altura completa de la pantalla incluso vacío). El scroll interno
          en la lista de ítems queda acotado a max-h, no a toda la altura,
          para no perder esa protección si el carrito tiene muchos ítems. ── */}
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

        <div className="max-h-[45vh] overflow-y-auto px-5 py-3 bg-white">
          {cart.length === 0 ? (
            <p className="text-center py-12 text-[12px] text-[#CBD5E1]">El carrito está vacío</p>
          ) : (
            cart.map((entry) => (
              <CartItem
                key={entry.item.id}
                entry={entry}
                displayPrice={getDisplayPrice(entry)}
                currency={saleCurrency}
                onRemove={removeFromCart}
                onSetPrice={setItemPrice}
              />
            ))
          )}
        </div>

        <div className="border-t border-[#E2E8F0] px-5 py-5 space-y-4 bg-white"
          style={{ boxShadow: '0 -1px 4px rgba(0,0,0,0.04)' }}>

          {/* Total + TC info */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] text-[#94A3B8] uppercase tracking-wider">Total</span>
              <span className="text-[24px] font-bold text-[#0F172A]">{fmtByCurrency(total, saleCurrency)}</span>
            </div>
            {saleCurrency !== 'ARS' && activeRate && (
              <p className="text-[11px] text-[#94A3B8] text-right mt-0.5">
                TC {saleCurrency === 'USDT' ? 'USDT (Binance)' : 'Blue'}: ${Math.round(activeRate).toLocaleString('es-AR')}
              </p>
            )}
            {noRateWarn && (
              <p className="text-[11px] text-amber-500 mt-1">
                ⚠ Cotización {saleCurrency} no disponible — precios sin convertir
              </p>
            )}
          </div>

          {/* Medio de pago */}
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

          {/* Moneda */}
          <div>
            <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider mb-2">Moneda de la venta</p>
            <div className="flex gap-1.5">
              {['ARS', 'USD', 'USDT'].map((cur) => (
                <button
                  key={cur}
                  onClick={() => handleCurrencyChange(cur)}
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
          </div>

          {/* Cliente */}
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
    </div>
  );
};

export default PosMain;
