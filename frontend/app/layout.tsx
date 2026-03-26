import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LangProvider } from "@/lib/lang-context";
import { ThemeProvider } from "@/lib/theme-context";
import { AuthProvider } from "@/lib/auth-provider";

export const metadata: Metadata = {
  title: "FloorScan — Analyse IA de Plans de Sol",
  description: "Détectez portes, fenêtres, murs et surfaces dans vos plans de construction grâce à l'IA.",
  keywords: "analyse plan de sol, IA construction, BIM, détection automatique, analyse PDF",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "FloorScan — Analyse IA de Plans de Sol",
    description: "Analyse IA instantanée de plans de construction.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="scroll-smooth">
      <body className="bg-ink text-slate-100 font-body antialiased">
        <a href="#main-content" className="skip-to-content">Skip to content</a>
        <AuthProvider>
          <ThemeProvider>
            <LangProvider>
              <main id="main-content">{children}</main>
              <Toaster />
            </LangProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
