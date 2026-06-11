import type { Metadata } from 'next';
import React from 'react';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'LinkedIn Outreach Copilot',
  description:
    'Human-in-the-loop LinkedIn outreach drafting for B2B sales teams. AI drafts, humans approve.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
