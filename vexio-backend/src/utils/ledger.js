// Helper compartido para reducir filas de LedgerEntry a un balance por moneda.
// Usado por cash.controller.js (balance de una sesión) y reports.controller.js
// (balance de un rango de fechas) — misma lógica, distinto filtro de entrada.
//
// `income`/`expense` son SOLO actividad operativa: SALE, CASH_MOVEMENT_INCOME
// (income) y CASH_MOVEMENT_EXPENSE (expense). SESSION_OPEN (saldo inicial) y
// SESSION_CLOSE_ADJUSTMENT (ajuste de conciliación) quedan deliberadamente
// afuera de ambos — no son plata que "entró" o "salió" operativamente, viven
// en sus propios campos (`openingBalance`, `adjustments`).
//
// Invariante que siempre se cumple: balance === openingBalance + income -
// expense + adjustments, porque cada fila se suma exactamente una vez a
// `balance` (sin condición) y exactamente una vez a alguno de los otros
// cuatro campos según su type.

// Tipos de LedgerEntry que NUNCA deben entrar en un balance mostrado al
// dueño del tenant (ver regla documentada en el modelo LedgerEntry del
// schema.prisma). El caller es responsable de aplicar este filtro en el
// `where` de la query — este helper no vuelve a filtrar por su cuenta para
// no esconder silenciosamente el criterio de exclusión.
//
// SUBSCRIPTION_PAYMENT: lo que el tenant le paga a Vexio, no es caja del
// negocio del tenant.
// PURCHASE_ORDER: registra que se generó una deuda con el proveedor al
// recibir la mercadería, no que salió plata de la caja en ese momento —
// PurchaseOrder no tiene paymentMethod y Supplier.paymentDays asume pago
// diferido por default. El pago real de esa deuda ya existe como acción
// (SupplierPayment, suppliers.controller.js) — cuando sale de una caja del
// local es type=CASH_MOVEMENT_EXPENSE (sí resta del balance, no se agrega
// acá); esta entrada PURCHASE_ORDER sigue sin afectar caja nunca.
// SUPPLIER_PAYMENT_EXTERNAL: pago a proveedor desde una cuenta externa a la
// empresa (no desde una caja del local) — mismo criterio que
// SUBSCRIPTION_PAYMENT/PURCHASE_ORDER, es trazabilidad de que se pagó, no
// plata que salió de ninguna caja del tenant.
const TENANT_BALANCE_EXCLUDED_TYPES = ['SUBSCRIPTION_PAYMENT', 'PURCHASE_ORDER', 'SUPPLIER_PAYMENT_EXTERNAL'];

/**
 * @param {{ currencyCode: string, amount: number, type: string }[]} rows
 *   `amount` debe venir ya parseado a number (el caller convierte el
 *   Decimal de Prisma antes de llamar a esta función).
 * @returns {Record<string, {
 *   openingBalance: number, income: number, expense: number,
 *   salesIncome: number, manualIncome: number, adjustments: number,
 *   balance: number,
 * }>}
 */
function reduceLedgerByCurrency(rows) {
  const byCurrency = {};

  const ensure = (code) => {
    if (!byCurrency[code]) {
      byCurrency[code] = {
        openingBalance: 0,
        income: 0,
        expense: 0,
        salesIncome: 0,
        manualIncome: 0,
        adjustments: 0,
        balance: 0,
      };
    }
    return byCurrency[code];
  };

  for (const row of rows) {
    const b = ensure(row.currencyCode);
    const amt = row.amount;
    b.balance += amt;

    switch (row.type) {
      case 'SESSION_OPEN':
        // Saldo transferido a la sesión, no un ingreso operativo del período
        // — no suma a `income`. Vive únicamente en `openingBalance`.
        b.openingBalance += amt;
        break;
      case 'CASH_MOVEMENT_INCOME':
        b.income += amt;
        b.manualIncome += amt;
        break;
      case 'CASH_MOVEMENT_EXPENSE':
        b.expense += Math.abs(amt);
        break;
      case 'SALE':
        b.income += amt;
        b.salesIncome += amt;
        break;
      case 'SESSION_CLOSE_ADJUSTMENT':
        // Ajuste de conciliación, no un ingreso/egreso operativo — vive
        // únicamente en `adjustments`, igual criterio que SESSION_OPEN.
        b.adjustments += amt;
        break;
      case 'CONVERSION':
      default:
        if (amt >= 0) b.income += amt; else b.expense += Math.abs(amt);
        break;
    }
  }

  for (const b of Object.values(byCurrency)) {
    for (const key of Object.keys(b)) {
      b[key] = parseFloat(b[key].toFixed(2));
    }
  }

  return byCurrency;
}

module.exports = { reduceLedgerByCurrency, TENANT_BALANCE_EXCLUDED_TYPES };
