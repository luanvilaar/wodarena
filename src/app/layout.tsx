import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { AppLoadingWrapper } from "@/components/AppLoadingWrapper";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { toBcp47 } from "@/i18n/locales";
import type { AppLocale } from "@/types";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-number",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://wodarena.com"),
  title: "WODArena | Líder em Competições de Functional Fitness",
  description: "Gerencie e acompanhe rankings, eventos, cronogramas e inscrições de Functional Fitness e Cross Training em tempo real.",
  keywords: ["crossfit", "functional fitness", "leaderboard", "competição", "wodarena", "box games"],
  openGraph: {
    title: "WODArena | Líder em Competições de Functional Fitness",
    description: "Gerencie e acompanhe rankings, eventos, cronogramas e inscrições de Functional Fitness e Cross Training em tempo real.",
    url: "https://wodarena.com",
    siteName: "WODArena",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/icon.svg",
        width: 800,
        height: 800,
        alt: "WODArena Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WODArena | Líder em Competições de Functional Fitness",
    description: "Gerencie e acompanhe rankings, eventos, cronogramas e inscrições de Functional Fitness e Cross Training em tempo real.",
    images: ["/icon.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0e11",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fora do middleware (/admin, /owner, /judge) getLocale() cai no default
  // pt-br — o painel continua renderizando em português sem nenhuma mudança.
  const locale = (await getLocale()) as AppLocale;
  const messages = await getMessages();

  return (
    <html lang={toBcp47(locale)} data-scroll-behavior="smooth" className={`h-full bg-background text-foreground ${inter.variable} ${ibmPlexSans.variable}`}>
      <body className="flex flex-col min-h-screen antialiased bg-background">
        <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
        <NextIntlClientProvider locale={locale} messages={{ Common: messages.Common, Nav: messages.Nav, Footer: messages.Footer, Errors: messages.Errors, Voucher: messages.Voucher }}>
          <AppProvider>
            <AppLoadingWrapper>
              <Navbar />
              <main id="main-content" className="flex-grow flex flex-col">
                {children}
              </main>
              <Footer />
            </AppLoadingWrapper>
          </AppProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
