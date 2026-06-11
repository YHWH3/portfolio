'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/Spinner';

export default function DashboardIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/drafts');
  }, [router]);

  return <PageLoader label="Redirecting to drafts…" />;
}
