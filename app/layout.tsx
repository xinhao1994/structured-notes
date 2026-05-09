import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "Structured Notes Desk",
  description:
    "Mobile-first structured investment / autocallable note tracking & proposal generation",
  applicationName: "SN Desk",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "SN Desk",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d111c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <ThemeProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 sm:px-6 pb-28 pt-4">
            {children}
          </main>
          <BottomNav />
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
