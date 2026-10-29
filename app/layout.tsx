import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${APP_NAME} �?" PR Intelligence`,
  description: APP_DESCRIPTION,
};

const themeInitScript = `(function(){try{var stored=localStorage.getItem("theme");var theme=stored==="light"||stored==="dark"||stored==="system"?stored:"system";var resolved=theme==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):theme;var root=document.documentElement;root.classList.remove("light","dark");root.classList.add(resolved);root.style.colorScheme=resolved;}catch(error){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
