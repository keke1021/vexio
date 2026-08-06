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

const CURRENCY_BADGE_CLS = {
  ARS:  'bg-[#F1F5F9] text-[#64748B]',
  USD:  'bg-[#DCFCE7] text-[#16A34A]',
  USDT: 'bg-[#DBEAFE] text-[#2563EB]',
};

const formatCurrency = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

const formatGeneric = (n, code) =>
  `${code} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)}`;

// Antes esta columna mostraba formatCurrency (pesos) sin mirar la moneda
// real del ítem — un equipo en USD/USDT se veía con el símbolo $ de ARS.
const formatByCurrency = (n, code) => (code === 'ARS' ? formatCurrency(n) : formatGeneric(n, code));

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

const BulkUploadModal = ({ tiendas, onClose, onSuccess }) => {
  const [file, setFile] = useState(null);
  const [tiendaId, setTiendaId] = useState(tiendas.length === 1 ? tiendas[0].id : '');
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
    if (!file || !tiendaId) return;
    setUploading(true);
    setProgress(10);

    const interval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 8, 85));
    }, 400);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tiendaId', tiendaId);
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
            {tiendas.length > 1 && (
              <div className="border border-[#E2E8F0] rounded-xl p-4 mb-3">
                <p className="text-[13px] text-[#0F172A] font-medium mb-2">Sucursal que recibe la carga</p>
                <select
                  value={tiendaId}
                  onChange={(e) => setTiendaId(e.target.value)}
                  className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
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
              <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-3">
                <p className="text-[13px] text-amber-600">
                  Todavía no hay ninguna sucursal creada — hace falta al menos una para poder cargar equipos.
                </p>
              </div>
            )}

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
                disabled={!file || !tiendaId || uploading}
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

  const PAGE_SIZE = 50;

  // Modelo e IMEI son dos campos separados a propósito — antes un único
  // "search" hacía OR parcial contra los dos, y buscar "16" (para "iPhone
  // 16") también traía cualquier IMEI que tuviera "16" en el medio.
  const [modeloSearch, setModeloSearch] = useState('');
  const [debouncedModelo, setDebouncedModelo] = useState('');
  const [imeiSearch, setImeiSearch] = useState('');
  const [debouncedImei, setDebouncedImei] = useState('');
  const [condition, setCondition] = useState('');
  const [status, setStatus] = useState('');
  const [tiendaId, setTiendaId] = useState('');
  const [page, setPage] = useState(1);
  const [showBulkModal, setShowBulkModal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedModelo(modeloSearch), 300);
    return () => clearTimeout(t);
  }, [modeloSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedImei(imeiSearch), 300);
    return () => clearTimeout(t);
  }, [imeiSearch]);

  // Cualquier cambio de filtro vuelve a la página 1 — si no, se puede quedar
  // "parado" en una página 4 que ya no existe para el filtro nuevo.
  useEffect(() => {
    setPage(1);
  }, [debouncedModelo, debouncedImei, condition, status, tiendaId]);

  const { data: tiendasData } = useQuery({
    queryKey: ['tiendas'],
    queryFn: () => api.get('/tiendas').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tiendas = tiendasData?.tiendas ?? [];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inventory', debouncedModelo, debouncedImei, condition, status, tiendaId, page],
    queryFn: () =>
      api.get('/inventory', {
        params: {
          modelo: debouncedModelo || undefined,
          imei: debouncedImei || undefined,
          condition: condition || undefined,
          status: status || undefined,
          tiendaId: tiendaId || undefined,
          page,
          pageSize: PAGE_SIZE,
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
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

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
            {isLoading ? '...' : total === 0
              ? '0 equipos'
              : `Mostrando ${rangeStart}-${rangeEnd} de ${total} equipo${total !== 1 ? 's' : ''}`}
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
          placeholder="Buscar por modelo..."
          value={modeloSearch}
          onChange={(e) => setModeloSearch(e.target.value)}
          className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A]
            placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-colors w-48"
        />
        <input
          type="text"
          placeholder="Buscar por IMEI..."
          value={imeiSearch}
          onChange={(e) => setImeiSearch(e.target.value)}
          className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] font-mono
            placeholder-[#CBD5E1] focus:outline-none focus:border-[#3B82F6] transition-colors w-48"
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
        {tiendas.length > 1 && (
          <select
            value={tiendaId}
            onChange={(e) => setTiendaId(e.target.value)}
            className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[13px] text-[#64748B]
              focus:outline-none focus:border-[#3B82F6] transition-colors"
          >
            <option value="">Todas las sucursales</option>
            {tiendas.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">IMEI</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Modelo</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Condición</th>
              {tiendas.length > 1 && (
                <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden md:table-cell">Sucursal</th>
              )}
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider">Estado</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Precio</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Moneda</th>
              <th className="text-right px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden lg:table-cell">Margen</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden xl:table-cell">Proveedor</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium text-[#94A3B8] uppercase tracking-wider hidden xl:table-cell">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={tiendas.length > 1 ? 10 : 9} className="text-center py-16 text-[#CBD5E1] text-[13px]">Cargando...</td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={tiendas.length > 1 ? 10 : 9} className="text-center py-16 text-red-400 text-[13px]">Error al cargar el inventario.</td>
              </tr>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <tr>
                <td colSpan={tiendas.length > 1 ? 10 : 9} className="text-center py-16 text-[#CBD5E1] text-[13px]">No hay equipos que coincidan con los filtros.</td>
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
                  {tiendas.length > 1 && (
                    <td className="px-4 py-3.5 text-[#94A3B8] hidden md:table-cell">
                      {item.tienda?.name ?? '—'}
                    </td>
                  )}
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right text-[#64748B] hidden lg:table-cell">
                    {formatByCurrency(item.salePrice, item.currencyCode ?? 'ARS')}
                  </td>
                  <td className="px-4 py-3.5 hidden lg:table-cell">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${
                      CURRENCY_BADGE_CLS[item.currencyCode] ?? CURRENCY_BADGE_CLS.ARS
                    }`}>
                      {item.currencyCode ?? 'ARS'}
                    </span>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-[12px] text-[#94A3B8]">
            Página {page} de {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]
                text-[13px] font-medium px-3 py-1.5 rounded-lg transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              className="border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]
                text-[13px] font-medium px-3 py-1.5 rounded-lg transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {showBulkModal && (
        <BulkUploadModal
          tiendas={tiendas}
          onClose={() => setShowBulkModal(false)}
          onSuccess={handleBulkSuccess}
        />
      )}
    </div>
  );
};

export default InventoryList;
