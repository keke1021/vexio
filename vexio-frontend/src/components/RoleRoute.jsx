import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleCanUseModule } from '../config/access';

// A dónde mandar a cada rol cuando no puede entrar a una ruta. TECH solo
// tiene Reparaciones, así que su "home" es /repairs (mandarlo a /dashboard
// causaría un loop: también está gateado para TECH).
const HOME_BY_ROLE = { TECH: '/repairs' };

// Guard de ruta por rol. Va anidado dentro de <PrivateRoute>/<Layout>, así que
// acá `user` siempre existe. `module` undefined ⇒ ruta "base" (Inicio, Soporte):
// permitida para OWNER/ADMIN/SELLER, no para TECH.
const RoleRoute = ({ module }) => {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (!roleCanUseModule(user.role, module)) {
    return <Navigate to={HOME_BY_ROLE[user.role] ?? '/dashboard'} replace />;
  }
  return <Outlet />;
};

export default RoleRoute;
