import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo } from "next/font/google";
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
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
