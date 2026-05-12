import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const formatCurrency = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0);

const formatDateTime = (d) =>
  new Date(d).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const ticketNumber = (id) => id?.slice(-6).toUpperCase() ?? '—';

const getPaymentLabel = (sale) => {
  const { paymentMethod, currency, exchangeRate } = sale;
  if (currency === 'USDT') {
    return exchangeRate
      ? `USDT (cambio $${Math.round(exchangeRate).toLocaleString('es-AR')})`
      : 'USDT';
  }
  switch (paymentMethod) {
    case 'CASH':
      return currency === 'USD' ? 'Efectivo USD' : 'Efectivo ARS';
    case 'TRANSFER':
      return 'Transferencia bancaria';
    case 'CARD':
      return 'Tarjeta de crédito/débito';
    case 'INSTALLMENTS':
      return 'En cuotas';
    default:
      return paymentMethod;
  }
};

const PosSaleDetail = () => {
  const { id } = useParams();
  const { tenant } = useAuth();

  const { data: sale, isLoading, isError } = useQuery({
    queryKey: ['pos-sale', id],
    queryFn: () => api.get(`/pos/sales/${id}`).then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 rounded-full border-2 border-[#E2E8F0] border-t-[#3B82F6] animate-spin" />
      </div>
    );
  }

  if (isError || !sale) {
    return (
      <div className="px-6 pt-12 text-center text-[#94A3B8] text-[13px]">
        <p>Venta no encontrada.</p>
        <Link to="/pos/sales" className="text-[#3B82F6] hover:underline mt-2 block">Volver al historial</Link>
      </div>
    );
  }

  return (
    <div className="px-6 pt-8 pb-16">

      <div className="flex items-center gap-3 mb-8 print:hidden">
        <Link to="/pos/sales" className="text-[#94A3B8] hover:text-[#64748B] transition-colors text-[13px]">
          ← Historial
        </Link>
        <span className="text-[#E2E8F0]">/</span>
        <span className="text-[13px] text-[#64748B]">Ticket #{ticketNumber(sale.id)}</span>
      </div>

      <div className="max-w-sm mx-auto">

        <div className="text-center mb-8 print:mb-6">
          {tenant?.name && (
            <p className="text-[15px] font-bold text-[#0F172A] print:text-black mb-1">{tenant.name}</p>
          )}
          <h1 className="text-[18px] font-semibold tracking-tight text-[#0F172A] print:text-black">Comprobante de venta</h1>
          <div className="mt-4 flex items-center justify-center gap-4 text-[12px] text-[#0F172A] print:text-black">
            <span>#{ticketNumber(sale.id)}</span>
            <span>·</span>
            <span>{formatDateTime(sale.createdAt)}</span>
          </div>
        </div>

        <div className="border border-[#E2E8F0] rounded-xl p-5 mb-4 space-y-3 bg-white print:border-gray-200"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div className="flex justify-between text-[13px]">
            <span className="text-[#0F172A] print:text-black">Vendedor</span>
            <span className="text-[#0F172A] font-medium print:text-black">{sale.seller?.name}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-[#0F172A] print:text-black">Medio de pago</span>
            <span className="text-[#0F172A] font-medium print:text-black">
              {getPaymentLabel(sale)}
            </span>
          </div>
          {sale.customerName && (
            <div className="flex justify-between text-[13px]">
              <span className="text-[#0F172A] print:text-black">Cliente</span>
              <span className="text-[#0F172A] print:text-black">{sale.customerName}</span>
            </div>
          )}
          {sale.customerPhone && (
            <div className="flex justify-between text-[13px]">
              <span className="text-[#0F172A] print:text-black">Teléfono</span>
              <span className="text-[#0F172A] print:text-black">{sale.customerPhone}</span>
            </div>
          )}
        </div>

        <div className="border border-[#E2E8F0] rounded-xl overflow-hidden mb-4 bg-white print:border-gray-200"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {sale.items?.map((si, idx) => (
            <div
              key={si.id}
              className={`p-4 ${idx < sale.items.length - 1 ? 'border-b border-[#E2E8F0] print:border-gray-100' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-[#0F172A] print:text-black">
                    {si.inventoryItem?.product?.name} {si.inventoryItem?.product?.storage}
                  </p>
                  <p className="text-[11px] text-[#0F172A] print:text-black mt-0.5">
                    {si.inventoryItem?.product?.color}
                  </p>
                  <p className="font-mono text-[11px] text-[#0F172A] print:text-black mt-1">
                    {si.inventoryItem?.imei}
                  </p>
                </div>
                <span className="text-[14px] font-semibold text-[#0F172A] print:text-black shrink-0">
                  {formatCurrency(si.salePrice)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="border border-[#E2E8F0] rounded-xl p-5 bg-white print:border-gray-200"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[#0F172A] print:text-black">Total</span>
            <span className="text-[26px] font-bold text-[#0F172A] print:text-black">
              {formatCurrency(sale.total)}
            </span>
          </div>
        </div>

        <div className="mt-6 flex gap-3 print:hidden">
          <button
            onClick={() => window.print()}
            className="flex-1 bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B]
              text-[13px] font-medium py-2.5 rounded-lg transition-colors"
          >
            Imprimir ticket
          </button>
          <Link
            to="/pos"
            className="flex-1 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[13px] font-medium
              py-2.5 rounded-lg transition-colors text-center"
          >
            Nueva venta
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PosSaleDetail;
