import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { AppLoadingWrapper } from "@/components/AppLoadingWrapper";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth" className="h-full bg-background text-foreground">
      <body className="flex flex-col min-h-screen antialiased bg-background">
        <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
        <AppProvider>
          <AppLoadingWrapper>
            <Navbar />
            <main id="main-content" className="flex-grow flex flex-col">
              {children}
            </main>
            <Footer />
          </AppLoadingWrapper>
        </AppProvider>
      </body>
    </html>
  );
}
