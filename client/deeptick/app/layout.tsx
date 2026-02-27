import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "DeepTick | AI Research",
  description: "AI-powered research agent for institutional-grade market analysis",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider defaultTheme="system">
          <AuthProvider>
            <div className="relative min-h-screen">
              <div className="noise pointer-events-none fixed inset-0 z-50" />
              {children}
            </div>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
