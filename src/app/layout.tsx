import type { Metadata } from "next";
import { Geist, Noto_Sans_SC } from "next/font/google";
import { Providers } from "@/components/providers";
import { brand } from "@/lib/brand";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const noto = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto",
});

export const metadata: Metadata = {
  title: `${brand.name} · ${brand.product}`,
  description: brand.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${geist.variable} ${noto.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
