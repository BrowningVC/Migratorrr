'use client';

import { cn } from '@/lib/utils';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
}

export function StepIndicator({
  currentStep,
  totalSteps,
  labels,
}: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }).map((_, index) => (
        <div key={index} className="flex items-center">
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all',
              index < currentStep
                ? 'bg-green-500 text-white'
                : index === currentStep
                  ? 'bg-green-500/20 text-green-400 ring-2 ring-green-500'
                  : 'bg-zinc-800 text-zinc-500'
            )}
          >
            {index < currentStep ? (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              index + 1
            )}
          </div>
          {index < totalSteps - 1 && (
            <div
              className={cn(
                'w-12 h-0.5 mx-1',
                index < currentStep ? 'bg-green-500' : 'bg-zinc-700'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
