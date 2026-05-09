import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { TweaksPanel } from "@/components/tweaks-panel";

export const metadata: Metadata = {
  title: "helpdesk.ai",
  description: "AI support that actually reads your docs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var t = localStorage.getItem("helpdesk-theme");
            if (t === "light") document.documentElement.setAttribute("data-theme", "light");
          })();
        `}} />
      </head>
      <body>
        <AuthProvider>
          {children}
          <TweaksPanel />
        </AuthProvider>
      </body>
    </html>
  );
}
