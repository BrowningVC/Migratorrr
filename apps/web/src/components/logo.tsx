'use client';

import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function Logo({ className, size = 'md' }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      className={cn(sizes[size], className)}
    >
      <defs>
        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#22C55E', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#10B981', stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Outer ring (target/scope) */}
      <circle
        cx="24"
        cy="24"
        r="22"
        stroke="url(#logoGradient)"
        strokeWidth="2"
        fill="none"
        opacity="0.3"
      />

      {/* Inner ring */}
      <circle
        cx="24"
        cy="24"
        r="16"
        stroke="url(#logoGradient)"
        strokeWidth="1.5"
        fill="none"
        opacity="0.5"
      />

      {/* Crosshair lines */}
      <line
        x1="24"
        y1="4"
        x2="24"
        y2="12"
        stroke="url(#logoGradient)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="36"
        x2="24"
        y2="44"
        stroke="url(#logoGradient)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="24"
        x2="12"
        y2="24"
        stroke="url(#logoGradient)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="36"
        y1="24"
        x2="44"
        y2="24"
        stroke="url(#logoGradient)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Migration arrow (moving right and up - representing catching migrations) */}
      <path
        d="M16 30 L24 22 L32 22"
        stroke="url(#logoGradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Arrow head */}
      <path
        d="M28 18 L32 22 L28 26"
        stroke="url(#logoGradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Center dot (target point) */}
      <circle cx="24" cy="24" r="3" fill="url(#logoGradient)" />
    </svg>
  );
}
