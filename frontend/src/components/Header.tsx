import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileSignature, LogOut, Plus, List, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isAdminLike } from '../utils/roles';

/**
 * En-tête léger du parapheur autonome (remplace le Header complet du Hub DSI,
 * qui dépendait des tuiles, du backlog, du thème et d'autres modules).
 */
const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const name = user?.displayName || user?.username || '';
  const initials = name ? name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() : '?';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 16,
        height: 60, padding: '0 1.5rem',
        background: '#fff', borderBottom: '2px solid var(--primary-color)',
        boxShadow: '0 1px 4px rgba(0,120,164,0.08)',
      }}
    >
      <Link to="/parapheur" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary-color)', fontWeight: 700, textDecoration: 'none' }}>
        <FileSignature size={20} />
        Parapheur électronique
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 16 }}>
        <Link to="/parapheur" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, color: '#475569', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
          <List size={15} /> Mes parapheurs
        </Link>
        <Link to="/parapheur/nouveau" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, color: '#475569', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
          <Plus size={15} /> Nouveau
        </Link>
        {isAdminLike(user) && (
          <Link to="/admin/parapheur-certificats" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, color: '#475569', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
            <ShieldCheck size={15} /> Certificats
          </Link>
        )}
      </nav>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 22, padding: '5px 12px 5px 6px', color: '#0369a1', fontSize: 13, fontWeight: 500 }}>
          <div style={{ width: 30, height: 30, minWidth: 30, borderRadius: '50%', background: 'var(--primary-color)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {initials}
          </div>
          <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </div>
        <button
          onClick={handleLogout}
          title="Se déconnecter"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
};

export default Header;
