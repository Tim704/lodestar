import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorNote } from '../components/ui';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(username, password);
      else {
        await register({
          username,
          password,
          display_name: displayName || username,
          ...(inviteCode ? { invite_code: inviteCode } : {}),
        });
      }
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-5xl text-gold">✦</div>
          <h1 className="h-display mt-2 text-3xl">Lodestar</h1>
          <p className="mt-1 text-sm text-muted">The student life OS. Find your north.</p>
        </div>

        <form className="card p-4" onSubmit={(e) => void submit(e)}>
          <ErrorNote error={error} />
          <label className="label" htmlFor="username">Username</label>
          <input
            id="username"
            className="input mb-3"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            minLength={3}
          />
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input mb-3"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : 1}
          />
          {mode === 'register' && (
            <>
              <label className="label" htmlFor="displayName">Display name</label>
              <input
                id="displayName"
                className="input mb-3"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={username || 'How friends see you'}
              />
              <label className="label" htmlFor="inviteCode">Invite code <span className="normal-case">(first user needs none)</span></label>
              <input
                id="inviteCode"
                className="input mb-3"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="from a group's settings"
              />
            </>
          )}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            className="mt-3 w-full text-center text-sm text-muted underline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
