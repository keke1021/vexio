import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../../api/axios';

// Acción rápida "Enviar a otra sucursal" — agrega el equipo al lote OPEN
// hacia la sucursal elegida (lo crea si no existe uno). Usada desde
// InventoryDetail; server-side el único gate real es assertTiendaAccess
// (¿este usuario puede sacar equipos de la sucursal de origen?), por eso acá
// no se restringe por rol — cualquiera que pueda ver el equipo puede
// intentarlo, y el backend responde 403 si no le corresponde.
const SendToTiendaPanel = ({ inventoryItemId, fromTiendaId, onSent }) => {
  const [open, setOpen] = useState(false);
  const [toTiendaId, setToTiendaId] = useState('');
  const [error, setError] = useState('');

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const options = (tiendasData?.tiendas ?? []).filter((t) => t.id !== fromTiendaId);

  const sendMutation = useMutation({
    mutationFn: () => api.post('/stock-transfers/items', { inventoryItemId, toTiendaId }).then((r) => r.data),
    onSuccess: (transfer) => {
      setError('');
      setOpen(false);
      setToTiendaId('');
      onSent?.(transfer);
    },
    onError: (err) => setError(err.response?.data?.message || 'Error al enviar el equipo.'),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[13px] text-[#3B82F6] hover:text-[#2563EB] transition-colors mb-4 block"
      >
        Enviar a otra sucursal →
      </button>
    );
  }

  return (
    <div className="border border-[#E2E8F0] rounded-xl p-4 mb-5 bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-[12px] text-[#3B82F6] font-medium uppercase tracking-wider mb-3">Enviar a otra sucursal</p>
      {options.length === 0 ? (
        <p className="text-[13px] text-[#475569]">No hay otra sucursal a la que transferir.</p>
      ) : (
        <>
          <select
            value={toTiendaId}
            onChange={(e) => setToTiendaId(e.target.value)}
            className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] mb-3
              focus:outline-none focus:border-[#3B82F6] transition-all"
          >
            <option value="">Elegí la sucursal destino</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={() => sendMutation.mutate()}
              disabled={!toTiendaId || sendMutation.isPending}
              className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg
                transition-colors disabled:opacity-40"
            >
              {sendMutation.isPending ? 'Enviando...' : 'Agregar al lote'}
            </button>
            <button
              onClick={() => { setOpen(false); setError(''); }}
              className="text-[13px] text-[#475569] hover:text-[#64748B] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default SendToTiendaPanel;
