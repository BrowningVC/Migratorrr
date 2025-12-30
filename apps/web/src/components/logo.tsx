'use client';

import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
};

export function Logo({ className, size = 'md' }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      className={cn(sizes[size], className)}
    >
      {/* Single abstract arrow mark - minimal, bold */}
      <path
        d="M8 38 L24 10 L40 38 L24 28 Z"
        fill="#22C55E"
      />
    </svg>
  );
}

// Styled brand text component
interface LogoTextProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const textSizes = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
};

export function LogoText({ className, size = 'md' }: LogoTextProps) {
  return (
    <span
      className={cn(
        'font-bold tracking-tight text-white',
        textSizes[size],
        className
      )}
    >
      Migratorrr
    </span>
  );
}
