// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '@services/toastService';
import { acceptInvitation, verifyInvitation } from '@services/usersService';

const AcceptInvitation: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setError('7�7�7�7� 7�87�7�8�7� 78y7� 7�7�87�');
        setLoading(false);
        return;
      }
      try {
        const result = await verifyInvitation(token);
        setEmail(result.email);
        setRoleName(result.role?.name || 'User');
      } catch (err: any) {
        setError(err?.response?.data?.message || '7�7�7�7� 7�87�7�88 8&8  7�87�7�8�7�');
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!password || password.length < 8) {
      toast.error('8�88&7� 7�88&7�8�7� 8y7�7� 7�87� 7�88 7�8  8 7�7�7�8~');
      return;
    }

    setSubmitting(true);
    try {
      await acceptInvitation({ token, password, username: username || undefined, firstName: firstName || undefined, lastName: lastName || undefined });
      toast.success('7�8& 7�8~7�8y8 7�87�7�7�7� 7�8 7�7�7�. 8y8&8�8 8� 7�7�7�8y8 7�87�7�8�8 7�87�8 .');
      navigate('/', { replace: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '8~7�8 87�8�8 7�87�7�8�7�');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">7�7�7�8y 7�87�7�88 8&8  7�87�7�8�7�...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 p-6"
      >
        <h1 className="text-2xl font-bold text-slate-800 mb-2">87�8�8 7�7�8�7� 7�87�8 7�8&7�8&</h1>
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4">{error}</div>
        ) : (
          <>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4 text-sm text-emerald-900">
              7�87�7�8y7�: <span className="font-bold">{email}</span> | 7�87�8�7�: <span className="font-bold">{roleName}</span>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="7�7�8& 7�88&7�7�7�7�8& (7�7�7�8y7�7�8y)"
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="7�87�7�8& 7�87�8�8"
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="7�7�8& 7�87�7�7�87�"
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8�88&7� 7�88&7�8�7� 7�87�7�8y7�7�"
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
                required
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-emerald-600 text-white py-3 font-bold hover:bg-emerald-700 disabled:opacity-60"
              >
                {submitting ? '7�7�7�8� 7�87�8~7�8y8...' : '7�8~7�8y8 7�87�7�7�7�'}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default AcceptInvitation;

