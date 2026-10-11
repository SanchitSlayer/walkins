import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
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

// Each page names itself; this is the frame and the fallback. The template
// keeps the brand at the end of every title, after what the page is.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = {
  themeColor: "#15140f",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLocale()} className={archivo.variable}>
      <body>
        <NextIntlClientProvider>
          {children}
          <OfflineSync />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
