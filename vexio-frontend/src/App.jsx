import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import PrivateRoute from './components/PrivateRoute';
import RoleRoute from './components/RoleRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InventoryList from './pages/inventory/InventoryList';
import InventoryNew from './pages/inventory/InventoryNew';
import InventoryDetail from './pages/inventory/InventoryDetail';
import PosMain from './pages/pos/PosMain';
import PosSales from './pages/pos/PosSales';
import PosSaleDetail from './pages/pos/PosSaleDetail';
import RepairsList from './pages/repairs/RepairsList';
import RepairsNew from './pages/repairs/RepairsNew';
import RepairsDetail from './pages/repairs/RepairsDetail';
import CashMain from './pages/cash/CashMain';
import CashMovementNew from './pages/cash/CashMovementNew';
import CashSessionsHistory from './pages/cash/CashSessionsHistory';
import CashSessionDetail from './pages/cash/CashSessionDetail';
import SuppliersList from './pages/suppliers/SuppliersList';
import SuppliersNew from './pages/suppliers/SuppliersNew';
import SuppliersDetail from './pages/suppliers/SuppliersDetail';
import SuppliersOrderNew from './pages/suppliers/SuppliersOrderNew';
import TransfersMain from './pages/transfers/TransfersMain';
import TransferDetail from './pages/transfers/TransferDetail';
import ReportsPage from './pages/reports/ReportsPage';
import ChangePassword from './pages/settings/ChangePassword';
import TicketsList from './pages/tickets/TicketsList';
import TicketsNew from './pages/tickets/TicketsNew';
import TicketDetail from './pages/tickets/TicketDetail';
import AdminTenants from './pages/admin/AdminTenants';
import AdminTenantDetail from './pages/admin/AdminTenantDetail';
import AdminStats from './pages/admin/AdminStats';
import AdminTickets from './pages/admin/AdminTickets';

const App = () => (
  <ThemeProvider>
  <AuthProvider>
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Registro público deshabilitado — decisión de negocio (2026-08-06):
          las cuentas de clientes las crea Ezequiel desde el panel de Admin
          (createTenant). /register redirige a /login en vez de mostrar el
          formulario. */}
      <Route path="/register" element={<Navigate to="/login" replace />} />

      <Route element={<PrivateRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />

          {/* /reports redirects to /dashboard (which shows reports) */}
          <Route path="/reports" element={<Navigate to="/dashboard" replace />} />

          {/* Módulos gateados por rol (mismo criterio que el backend valida
              en cash / pos / suppliers / stockTransfers routes). */}
          <Route element={<RoleRoute module="inventory" />}>
            <Route path="/inventory"      element={<InventoryList />} />
            <Route path="/inventory/new"  element={<InventoryNew />} />
            <Route path="/inventory/:id"  element={<InventoryDetail />} />
          </Route>

          <Route element={<RoleRoute module="pos" />}>
            <Route path="/pos"             element={<PosMain />} />
            <Route path="/pos/sales"       element={<PosSales />} />
            <Route path="/pos/sales/:id"   element={<PosSaleDetail />} />
          </Route>

          <Route element={<RoleRoute module="repairs" />}>
            <Route path="/repairs"         element={<RepairsList />} />
            <Route path="/repairs/new"     element={<RepairsNew />} />
            <Route path="/repairs/:id"     element={<RepairsDetail />} />
          </Route>

          <Route element={<RoleRoute module="cash" />}>
            <Route path="/cash"                  element={<CashMain />} />
            <Route path="/cash/movements/new"    element={<CashMovementNew />} />
            <Route path="/cash/sessions"         element={<CashSessionsHistory />} />
            <Route path="/cash/sessions/:id"     element={<CashSessionDetail />} />
          </Route>

          <Route element={<RoleRoute module="suppliers" />}>
            <Route path="/suppliers"                        element={<SuppliersList />} />
            <Route path="/suppliers/new"                    element={<SuppliersNew />} />
            <Route path="/suppliers/:id"                    element={<SuppliersDetail />} />
            <Route path="/suppliers/:id/orders/new"         element={<SuppliersOrderNew />} />
          </Route>

          <Route element={<RoleRoute module="multibranch" />}>
            <Route path="/transfers"     element={<TransfersMain />} />
            <Route path="/transfers/:id" element={<TransferDetail />} />
          </Route>

          <Route path="/settings/password" element={<ChangePassword />} />

          <Route path="/tickets"       element={<TicketsList />} />
          <Route path="/tickets/new"   element={<TicketsNew />} />
          <Route path="/tickets/:id"   element={<TicketDetail />} />
        </Route>
      </Route>

      <Route element={<AdminRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin"                element={<AdminTenants />} />
          <Route path="/admin/tenants/:id"    element={<AdminTenantDetail />} />
          <Route path="/admin/stats"          element={<AdminStats />} />
          <Route path="/admin/tickets"        element={<AdminTickets />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  </AuthProvider>
  </ThemeProvider>
);

export default App;
