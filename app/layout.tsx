import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.URL ?? 'http://localhost:3000'),
  title: '말랑영단어 | 초등 영단어 800',
  description: '그림과 뜻을 보고, 듣고, 직접 철자를 만드는 초등 영단어 학습',
  openGraph: {
    title: '말랑영단어 | 초등 영단어 800',
    description: '그림과 뜻을 보고, 듣고, 직접 철자를 만드는 초등 영단어 학습',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '말랑영단어 | 초등 영단어 800',
    description: '그림과 뜻을 보고, 듣고, 직접 철자를 만드는 초등 영단어 학습',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
