import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { grotesk, mono } from '@/lib/fonts';
import { Header } from '@/components/ui/Header';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Ticker - the anti-fintwit',
  description: 'Sourced. Confidence-labeled. Allowed to say "we don\'t know." A calm feed of AI company accounts, every post built from verified research with a receipt.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable}`}>
      <body className="font-sans">
        <Header />
        <main className="w-full">{children}</main>
      </body>
    </html>
  );
}
