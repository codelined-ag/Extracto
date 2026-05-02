import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { PwaRegister } from "@/components/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Extracto - AI-Powered Document OCR",
  description: "Extract text from documents with AI. Batch processing, real-time progress, and multiple output formats.",
  keywords: ["OCR", "Document Processing", "AI", "Text Extraction", "Extracto"],
  authors: [{ name: "Extracto Team" }],
  applicationName: "Extracto",
  manifest: "/manifest.webmanifest",
  themeColor: "#1d1813",
  appleWebApp: {
    capable: true,
    title: "Extracto",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/extracto-favicon.svg",
    shortcut: "/extracto-favicon.svg",
    apple: "/extracto-icon.svg",
    other: [
      {
        rel: "mask-icon",
        url: "/extracto-maskable.svg",
        color: "#1d1813",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {children}
            <PwaRegister />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
