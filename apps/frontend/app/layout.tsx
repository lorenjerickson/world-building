import type { Metadata } from "next";
import { UserProvider } from "@auth0/nextjs-auth0/client";
import { AppHeader } from "@/components/app-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Wanderlust VTT",
    template: "%s | Wanderlust VTT",
  },
  description:
    "A virtual tabletop for creating worlds, designing rules, running campaigns, and playing together.",
  applicationName: "Wanderlust VTT",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <UserProvider><AppHeader />{children}</UserProvider>
      </body>
    </html>
  );
}
