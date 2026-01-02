import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from 'react-hot-toast';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: 'Bondshot',
  description: 'Automated token sniping for PumpFun migrations to Raydium',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${spaceGrotesk.variable}`}>
      <body className="font-sans">
        <Providers>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 5000,
              style: {
                background: 'hsl(224 71% 4%)',
                color: 'hsl(213 31% 91%)',
                border: '1px solid hsl(216 34% 17%)',
              },
              success: {
                iconTheme: {
                  primary: 'hsl(142 76% 36%)',
                  secondary: 'hsl(210 40% 98%)',
                },
              },
              error: {
                iconTheme: {
                  primary: 'hsl(0 84.2% 60.2%)',
                  secondary: 'hsl(210 40% 98%)',
                },
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
