'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (forgotMode) {
        await api.post<{ success: boolean }>('/api/v1/auth/forgot-password', {
          email,
        });
        setForgotSent(true);
        toast.success('If an account exists, a reset link has been sent.');
      } else {
        await login(email, password);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
            LO
          </span>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">
            LinkedIn Outreach Copilot
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            AI drafts your outreach. You stay in control.
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {forgotMode ? 'Reset your password' : 'Sign in'}
          </h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="you@company.com"
              />
            </div>
            {!forgotMode && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="••••••••"
                />
              </div>
            )}
            {forgotMode && forgotSent && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Check your inbox for a password reset link.
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {submitting && <Spinner size="sm" className="border-white/40 border-t-white" />}
              {forgotMode ? 'Send reset link' : 'Sign in'}
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setForgotMode((m) => !m);
                setForgotSent(false);
              }}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              {forgotMode ? 'Back to sign in' : 'Forgot password?'}
            </button>
            <Link
              href="/auth/register"
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              Create account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
