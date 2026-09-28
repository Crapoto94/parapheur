import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ParapheurList from './pages/Parapheur/ParapheurList';
import ParapheurCreate from './pages/Parapheur/ParapheurCreate';
import ParapheurDetail from './pages/Parapheur/ParapheurDetail';
import SignatureSignataire from './pages/Parapheur/SignatureSignataire';
import ParapheurVerification from './pages/Parapheur/ParapheurVerification';
import ParapheurShare from './pages/Parapheur/ParapheurShare';
import ParapheurCertificats from './pages/Admin/ParapheurCertificats';
import { isAdminLike } from './utils/roles';

// Protected Route Component (reprise allégée de l'AppDSI : le parapheur est le
// seul module de cette application).
const PrivateRoute = ({ children, path }: { children: React.ReactNode; path?: string }) => {
  const token = localStorage.getItem('token');
  const restrictedPath = localStorage.getItem('restrictedPath');
  let user: any = {};
  try {
    user = JSON.parse(localStorage.getItem('user') || '{}');
  } catch (e) {
    console.error('Erreur lors du parsing du user en localStorage', e);
  }

  if (!token) {
    if (window.location.search.includes('nomenu')) {
      localStorage.setItem('restrictedPath', window.location.pathname + window.location.search);
      return <Navigate to="/login" />;
    }
    const target = window.location.pathname + window.location.search;
    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} />;
  }

  if (restrictedPath) {
    if (path && path !== restrictedPath) {
      const isSamePath = path === restrictedPath || (restrictedPath && path && restrictedPath.startsWith(path));
      if (!isSamePath) return <Navigate to={restrictedPath} />;
    }
  }

  if (path && user.authorized_urls && !user.authorized_urls.includes('*')) {
    const isAuthorized = user.authorized_urls.some((url: string) => path === url || path.startsWith(url + '/'));
    if (!isAuthorized && path !== '/') return <Navigate to="/" />;
  }

  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  let user: any = {};
  try {
    user = JSON.parse(localStorage.getItem('user') || '{}');
  } catch { /* ignore */ }
  if (!isAdminLike(user)) return <Navigate to="/parapheur" replace />;
  return <PrivateRoute path="/admin/parapheur-certificats">{children}</PrivateRoute>;
};

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signature/:token" element={<SignatureSignataire />} />
      <Route path="/parapheur/verification/:token" element={<ParapheurVerification />} />
      <Route path="/parapheur/partage/:token" element={<ParapheurShare />} />
      <Route path="/parapheur" element={<PrivateRoute path="/parapheur"><ParapheurList /></PrivateRoute>} />
      <Route path="/parapheur/nouveau" element={<PrivateRoute path="/parapheur"><ParapheurCreate /></PrivateRoute>} />
      <Route path="/parapheur/:id" element={<PrivateRoute path="/parapheur"><ParapheurDetail /></PrivateRoute>} />
      <Route path="/admin/parapheur-certificats" element={<AdminRoute><ParapheurCertificats /></AdminRoute>} />
      <Route path="/" element={<Navigate to="/parapheur" replace />} />
      <Route path="*" element={<Navigate to="/parapheur" replace />} />
    </Routes>
  );
}
