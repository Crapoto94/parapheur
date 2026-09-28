import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileSignature, Loader2, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/** Écran de connexion minimal — même endpoint que le Hub DSI (magapp-login). */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/magapp-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.accessToken) {
        throw new Error(data.message || 'Identifiants invalides');
      }
      login(data.accessToken, data.user);
      const restricted = localStorage.getItem('restrictedPath');
      const redirect = params.get('redirect');
      if (restricted) {
        navigate(restricted);
      } else if (redirect) {
        navigate(redirect);
      } else {
        navigate('/parapheur');
      }
    } catch (err: any) {
      setError(err.message || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 28, boxShadow: '0 10px 30px rgba(2,6,23,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileSignature size={24} color="#7c3aed" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#0f172a' }}>Parapheur électronique</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>Connexion</p>
          </div>
        </div>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>Identifiant</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 14, marginBottom: 14, outline: 'none' }}
        />

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>Mot de passe</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 14, marginBottom: 14, outline: 'none' }}
        />

        {error && <p style={{ margin: '0 0 14px', fontSize: 13, color: '#b91c1c' }}>{error}</p>}

        <button
          type="submit"
          disabled={loading || !username || !password}
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 14px', background: 'var(--primary-color)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer', opacity: loading || !username || !password ? 0.7 : 1 }}
        >
          {loading ? <Loader2 size={17} className="spin" /> : <LogIn size={17} />}
          Se connecter
        </button>
      </form>
    </div>
  );
}
