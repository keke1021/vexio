import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import api from '../../api/axios';

// Buscador de equipos disponibles — mismo endpoint y patrón de debounce que
// PosMain.jsx (GET /pos/search-item). El backend ya acota a la sucursal activa
// del JWT, que es siempre el origen de la transferencia.
const useAvailableItemsSearch = (enabled) => {
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useQuery({
    queryKey: ['pos-search', debouncedQ],
    queryFn: () => api.get('/pos/search-item', { params: { q: debouncedQ } }).then((r) => r.data),
    enabled: enabled && debouncedQ.trim().length >= 2,
    staleTime: 10_000,
  });

  return { search, setSearch, debouncedQ, results: data?.items ?? [], isFetching };
};

// Modal de alta rápida: elegir destino, buscar y sumar equipos al lote OPEN
// (el backend resuelve solo si hay que crear uno nuevo o sumarse a uno ya
// existente — POST /stock-transfers/items, sin tocar). onClose(transferId?):
// transferId presente -> "Ir al lote", ausente -> cierre simple.
const NewTransferModal = ({ fromTiendaId, tiendas, onClose }) => {
  const queryClient = useQueryClient();
  const searchRef = useRef(null);

  const [toTiendaId, setToTiendaId] = useState('');
  const [transfer, setTransfer] = useState(null);
  const [addedIds, setAddedIds] = useState(new Set());
  const [error, setError] = useState('');

  const destinoOptions = tiendas.filter((t) => t.id !== fromTiendaId);
  const { search, setSearch, debouncedQ, results, isFetching } = useAvailableItemsSearch(!!toTiendaId);

  useEffect(() => {
    if (toTiendaId) searchRef.current?.focus();
  }, [toTiendaId]);

  // Preview del lote OPEN ya existente para esta combinación (si alguien ya
  // venía sumando equipos hoy) — mismo endpoint que usa TransfersMain, no
  // arranca a ciegas asumiendo que el lote está vacío.
  const { data: openLotData } = useQuery({
    queryKey: ['stock-transfer-open', fromTiendaId, toTiendaId],
    queryFn: () => api.get('/stock-transfers/open', { params: { toTiendaId } }).then((r) => r.data),
    enabled: !!toTiendaId,
    staleTime: 0,
  });
  useEffect(() => {
    if (openLotData) setTransfer(openLotData.transfer);
  }, [openLotData]);

  const changeDestino = (id) => {
    setToTiendaId(id);
    setTransfer(null);
    setAddedIds(new Set());
    setError('');
  };

  const addMutation = useMutation({
    mutationFn: (item) => api.post('/stock-transfers/items', { inventoryItemId: item.id, toTiendaId }).then((r) => r.data),
    onSuccess: (updatedTransfer, item) => {
      setError('');
      setTransfer(updatedTransfer);
      setAddedIds((prev) => new Set(prev).add(item.id));
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al agregar el equipo al lote.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => onClose()}>
      <div
        className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0] shrink-0">
          <p className="text-[14px] font-semibold text-[#0F172A]">Nueva transferencia</p>
          <button onClick={() => onClose()} className="text-[#475569] hover:text-[#64748B] transition-colors" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="mb-4">
            <label className="block text-[11px] font-medium text-[#475569] uppercase tracking-wider mb-1.5">
              Sucursal destino
            </label>
            <select
              value={toTiendaId}
              onChange={(e) => changeDestino(e.target.value)}
              className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
                focus:outline-none focus:border-[#3B82F6] transition-all"
            >
              <option value="">Elegí la sucursal destino</option>
              {destinoOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {toTiendaId && (
            <>
              <div className="relative mb-3">
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Escanear IMEI o buscar modelo..."
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-4 py-2.5 text-[13px] text-[#0F172A]
                    placeholder-[#CBD5E1] font-mono focus:outline-none focus:border-[#3B82F6] transition-all"
                />
                {isFetching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-[#E2E8F0] border-t-[#3B82F6] animate-spin" />
                )}
              </div>

              {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}

              <div className="space-y-2 mb-5">
                {debouncedQ.length >= 2 && !isFetching && results.length === 0 && (
                  <p className="text-center py-6 text-[13px] text-[#64748B]">
                    Ningún equipo disponible para &ldquo;{debouncedQ}&rdquo; en esta sucursal.
                  </p>
                )}
                {results.map((item) => {
                  const added = addedIds.has(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => !added && addMutation.mutate(item)}
                      disabled={added || addMutation.isPending}
                      className={`w-full text-left border rounded-lg px-4 py-3 transition-all ${
                        added
                          ? 'border-[#E2E8F0] bg-[#F8FAFC] opacity-50 cursor-not-allowed'
                          : 'border-[#E2E8F0] bg-white hover:border-[#3B82F6]/50 hover:bg-[#EFF6FF] cursor-pointer'
                      }`}
                    >
                      <p className="text-[13px] font-medium text-[#0F172A]">
                        {item.product.name} · {item.product.color} · {item.product.storage}
                      </p>
                      <p className="font-mono text-[11px] text-[#475569] mt-0.5">{item.imei}</p>
                      {added && <p className="text-[11px] text-[#3B82F6] mt-1">Ya está en el lote</p>}
                    </button>
                  );
                })}
              </div>

              {transfer?.transferItems?.length > 0 && (
                <div>
                  <p className="text-[11px] text-[#3B82F6] uppercase tracking-widest font-medium mb-2">
                    Lote en armado ({transfer.transferItems.length})
                  </p>
                  <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                    {transfer.transferItems.map((ti) => (
                      <div key={ti.id} className="px-3 py-2 border-b border-[#E2E8F0] last:border-0 flex items-center justify-between gap-3">
                        <p className="text-[12px] text-[#0F172A] truncate">
                          {[ti.inventoryItem.product?.name, ti.inventoryItem.product?.color, ti.inventoryItem.product?.storage]
                            .filter(Boolean).join(' ')}
                        </p>
                        <p className="font-mono text-[11px] text-[#475569] shrink-0">{ti.inventoryItem.imei}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[#E2E8F0] px-5 py-4 flex items-center gap-3 shrink-0">
          <button onClick={() => onClose()} className="text-[13px] text-[#475569] hover:text-[#64748B] transition-colors">
            Seguir después
          </button>
          {transfer && (
            <button
              onClick={() => onClose(transfer.id)}
              className="ml-auto bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg
                transition-colors"
            >
              Ir al lote y despachar →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewTransferModal;
