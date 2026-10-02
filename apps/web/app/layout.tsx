import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo } from "next/font/google";
import { OfflineSync } from "@/components/offline-sync";
import "./globals.css";

// One variable file supplies every width in the system (expanded headings,
// standard body, narrow board data) through the wdth axis, rather than
// loading Archivo Narrow as a separate family.
const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Walkins",
  description: "Walk-in interview platform",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#15140f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        {children}
        <OfflineSync />
      </body>
    </html>
  );
}
