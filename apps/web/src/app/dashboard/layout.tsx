'use client';

import { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ui/error-boundary';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
