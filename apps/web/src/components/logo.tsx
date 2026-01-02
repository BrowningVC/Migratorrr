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
      {/* Bondshot logo - targeting crosshair with bond/connection element */}
      {/* Outer ring */}
      <circle
        cx="24"
        cy="24"
        r="18"
        stroke="#f97316"
        strokeWidth="2.5"
        fill="none"
      />
      {/* Inner ring */}
      <circle
        cx="24"
        cy="24"
        r="10"
        stroke="#f97316"
        strokeWidth="2"
        fill="none"
      />
      {/* Center dot - the target */}
      <circle
        cx="24"
        cy="24"
        r="3"
        fill="#f97316"
      />
      {/* Crosshair lines */}
      <line x1="24" y1="2" x2="24" y2="12" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="36" x2="24" y2="46" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="2" y1="24" x2="12" y2="24" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="36" y1="24" x2="46" y2="24" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
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
      Bondshot
    </span>
  );
}
