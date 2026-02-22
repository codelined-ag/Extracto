import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
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

export const metadata: Metadata = {
  title: "Extracto - AI-Powered Document OCR",
  description: "Extract text from documents with AI. Batch processing, real-time progress, and multiple output formats.",
  keywords: ["OCR", "Document Processing", "AI", "Text Extraction", "Extracto"],
  authors: [{ name: "Extracto Team" }],
  applicationName: "Extracto",
  manifest: "/manifest.webmanifest",
  themeColor: "#0f172a",
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
        color: "#0f172a",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <PwaRegister />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
