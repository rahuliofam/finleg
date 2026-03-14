import type { Metadata } from "next";
import { Geist, Playfair_Display } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Finleg",
  description: "Financial and legal hassles — now united in a single AI platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${playfair.variable}`}>
      <head>
        {/* Add Google Fonts here if your locales need non-Latin scripts */}
      </head>
      <body className="min-h-screen flex flex-col antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
