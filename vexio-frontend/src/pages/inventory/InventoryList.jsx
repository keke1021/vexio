import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const CONDITIONS = { NEW: 'Nuevo', LIKE_NEW: 'Como nuevo', REFURBISHED: 'Reacond.', USED: 'Usado' };

const getStockBadge = (item) => {
  if (item.status === 'SOLD')      return { label: 'Vendido',    cls: 'text-[#94A3B8] bg-[#F1F5F9]' };
  if (item.status === 'RESERVED')  return { label: 'Reservado',  cls: 'text-[#3B82F6] bg-[#EFF6FF]' };
  if (item.status === 'DEFECTIVE') return { label: 'Baja',       cls: 'text-red-500 bg-red-50' };
  if (item.stockCount === 1)                          return { label: 'Último',     cls: 'text-orange-500 bg-orange-50' };
  if (item.stockCount <= item.product.minStock)       return { label: 'Stock bajo', cls: 'text-yellow-600 bg-yellow-50' };
  return { label: 'Disponible', cls: 'text-emerald-600 bg-emerald-50' };
};

const getMarginColor = (m) => {
  if (m >= 30) return 'text-emerald-600';
  if (m >= 10) return 'text-yellow-600';
  return 'text-red-500';
};

const formatCurrency = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

const formatDate = (d) =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

// ─── Alerts Banner ────────────────────────────────────────────────────────────

const AlertsBanner = () => {
  const { data } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: () => api.get('/inventory/alerts').then((r) => r.data),
    staleTime: 60_000,
  });

  if (!data?.total) return null;

  return (
    <div className="mb-5 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 flex items-start gap-3">
      <span className="text-yellow-500 text-[13px] mt-px">⚠</span>
      <div>
        <p className="text-[13px] text-yellow-700 font-medium">
          {data.total} modelo{data.total > 1 ? 's' : ''} con stock bajo
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {data.alerts.slice(0, 5).map((a) => (
            <span key={a.product.id} className="text-[11px] text-yellow-600">
              {a.product.name} {a.product.storage} ({a.availableCount})
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Bulk Upload Modal ────────────────────────────────────────────────────────

const BulkUploadModal = ({ onClose, onSuccess }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['modelo', 'color', 'almacenamiento', 'condicion', 'costo', 'precio_venta', 'moneda', 'proveedor', 'imei', 'notas'],
      ['iPhone 14', 'Negro', '128GB', 'Nuevo', 700, 900, 'ARS', 'Proveedor Ejemplo', '', ''],
      ['iPhone 13 Pro', 'Azul Sierra', '256GB', 'Como nuevo', 620, 820, 'USD', 'Proveedor Ejemplo', '352999112345678', ''],
    ]);
    ws['!cols'] = [14, 14, 14, 14, 10, 12, 8, 18, 20, 20].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    XLSX.writeFile(wb, 'plantilla-inventario.xlsx');
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(10);

    const interval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 8, 85));
    }, 400);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/inventory/bulk-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      clearInterval(interval);
      setProgress(100);
      setResult(data);
      onSuccess();
    } catch (err) {
      clearInterval(interval);
      setProgress(0);
      setResult({ error: err.response?.data?.message || 'Error al procesar el archivo.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-lg p-6"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-semibold text-[#0F172A]">Carga masiva de inventario</h2>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#64748B] text-[22px] leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {!result ? (
          <>
            <div className="border border-[#E2E8F0] rounded-xl p-4 mb-3">
              <p className="text-[13px] text-[#0F172A] font-medium mb-1">1. Descargá la plantilla</p>
              <p className="text-[12px] text-[#94A3B8] mb-3">
                Completá el archivo Excel con los datos de tus equipos. El campo IMEI es opcional.
              </p>
              <button
                onClick={downloadTemplate}
                className="text-[12px] text-[#3B82F6] hover:text-[#2563EB] font-medium transition-colors"
              >
                ↓ Descargar plantilla.xlsx
              </button>
            </div>

            <div className="border border-[#E2E8F0] rounded-xl p-4 mb-4">
              <p className="text-[13px] text-[#0F172A] font-medium mb-1">2. Subí el archivo completado</p>
              <p className="text-[12px] text-[#94A3B8] mb-3">Solo se aceptan archivos .xlsx y .csv</p>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => setFile(e.target.files[0] || null)}
                className="text-[12px] text-[#64748B]
                  file:mr-3 file:bg-[#EFF6FF] file:text-[#3B82F6] file:border-0
                  file:rounded-lg file:px-3 file:py-1.5 file:text-[12px] file:font-medium
                  hover:file:bg-[#D6EBFA] file:cursor-pointer file:transition-colors"
              />
              {file && (
                <p className="text-[11px] text-[#94A3B8] mt-2">{file.name}</p>
              )}
            </div>

            {uploading && (
              <div className="mb-4">
                <div className="h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#3B82F6] rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-[#94A3B8] mt-1.5">Procesando... {progress}%</p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="text-[13px] text-[#94A3B8] hover:text-[#64748B] transition-colors px-4 py-2"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-40 disabled:cursor-not-allowed
                  text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {uploading ? 'Procesando...' : 'Subir archivo'}
              </button>
            </div>
          </>
        ) : result.error ? (
          <div>
            <div className="border border-red-200 bg-red-50 rounded-xl p-4 mb-4">
              <p className="text-[13px] text-red-600">{result.error}</p>
            </div>
            <button
              onClick={() => setResult(null)}
              className="text-[13px] text-[#3B82F6] hover:text-[#2563EB] font-medium transition-colors"
            >
              ← Intentar de nuevo
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-6 mb-5">
              <div className="text-center">
                <p className="text-[32px] font-bold text-emerald-600">{result.loaded}</p>
                <p className="text-[11px] text-[#94A3B8] mt-0.5">cargados correctamente</p>
              </div>
              {result.failed > 0 && (
                <div className="text-center">
                  <p className="text-[32px] font-bold text-red-500">{result.failed}</p>
                  <p className="text-[11px] text-[#94A3B8] mt-0.5">errores</p>
                </div>
              )}
            </div>

            {result.errors?.length > 0 && (
              <div className="border border-[#E2E8F0] rounded-xl p-3 max-h-44 overflow-y-auto mb-4">
                <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider mb-2">Detalle de errores</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-[12px] text-red-500 mb-1">
                    Fila {e.row}: {e.reason}
                  </p>
                ))}
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full bg-[#EFF6FF] hover:bg-[#D6EBFA] text-[#3B82F6]
                text-[13px] font-medium py-2.5 rounded-lg transition-colors"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const InventoryList = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = ['OWNER', 'ADMIN'].includes(user?.role);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [condition, setCondition] = useState('');
  const [status, setStatus] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inventory', debouncedSearch, condition, status],
    queryFn: () =>
      api.get('/inventory', {
        params: {
          search: debouncedSearch || undefined,
          condition: condition || undefined,
          status: status || undefined,
        },
      }).then((r) => r.data),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/inventory/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const handleBulkSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
  };

  return (
    <div className="px-6 pt-8 pb-16 max-w-[1200px] mx-auto">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#0F172A]">Inventario</h1>
          <p className="text-[13px] text-[#94A3B8] mt-0.5">
            {isLoading ? '...' : `${total} equipo${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBulkModal(true)}
              className="border border-[#3B82F6]/40 text-[#3B82F6] hover:bg-[#EFF6FF]
                text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Carga masiva
            </button>
            <Link
              to="/inventory/new"
              className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + Agregar equipo
            </Link>
          </div>
        )}
      </div>

      <AlertsBanner />

      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          placeholder="Buscar IMEI o modelo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
            placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-colors w-56"
        />
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
            focus:outline-none focus:border-[#3B82F6] transition-colors"
        >
          <option value="">Todas las condiciones</option>
          {Object.entries(CONDITIONS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
            focus:outline-none focus:border-[#3B82F6] transition-colors"
        >
          <option value="">Todos los estados</option>
          <option value="AVAILABLE">Disponible</option>
          <option value="SOLD">Vendido</option>
          <option value="RESERVED">Reservado</option>
        </select>
      </div>

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">IMEI</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Modelo</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Condición</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Estado</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Precio</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Margen</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden xl:table-cell">Proveedor</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden xl:table-cell">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-[#CBD5E1] text-[13px]">Cargando...</td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-red-400 text-[13px]">Error al cargar el inventario.</td>
              </tr>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-[#CBD5E1] text-[13px]">No hay equipos que coincidan con los filtros.</td>
              </tr>
            )}
            {items.map((item) => {
              const badge = getStockBadge(item);
              return (
                <tr
                  key={item.id}
                  onClick={() => navigate(`/inventory/${item.id}`)}
                  className="border-b border-[#E2E8F0] hover:bg-[#EFF6FF] transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3.5 font-mono text-[#94A3B8] text-[12px] group-hover:text-[#64748B] transition-colors">
                    {item.imei}
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="text-[#0F172A] font-medium">{item.product.name}</p>
                    <p className="text-[#94A3B8] text-[11px]">{item.product.color} · {item.product.storage}</p>
                  </td>
                  <td className="px-4 py-3.5 text-[#64748B] hidden md:table-cell">
                    {CONDITIONS[item.condition]}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right text-[#64748B] hidden lg:table-cell">
                    {formatCurrency(item.salePrice)}
                  </td>
                  <td className={`px-4 py-3.5 text-right font-medium hidden lg:table-cell ${getMarginColor(item.margin)}`}>
                    {item.margin.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3.5 text-[#94A3B8] hidden xl:table-cell">
                    {item.supplier?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3.5 text-[#CBD5E1] hidden xl:table-cell">
                    {formatDate(item.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showBulkModal && (
        <BulkUploadModal
          onClose={() => setShowBulkModal(false)}
          onSuccess={handleBulkSuccess}
        />
      )}
    </div>
  );
};

export default InventoryList;
