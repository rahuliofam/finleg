import type { Metadata } from "next";
import { Geist, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { AuthProvider } from "@/contexts/auth-context";

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
  metadataBase: new URL("https://finleg.net"),
  openGraph: {
    title: "Finleg",
    description: "Financial and legal hassles — now united in a single AI platform.",
    url: "https://finleg.net",
    siteName: "Finleg",
    images: [
      {
        url: "/og-image-v2.png",
        width: 1200,
        height: 630,
        alt: "Finleg",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Finleg",
    description: "Financial and legal hassles — now united in a single AI platform.",
    images: ["/og-image-v2.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${playfair.variable}`}>
      <head />
      <body className="min-h-screen flex flex-col antialiased bg-background text-foreground">
        <AuthProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
