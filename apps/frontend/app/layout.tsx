import type { Metadata } from "next";
import { UserProvider } from "@auth0/nextjs-auth0/client";
import { GlobalSearch } from "@/components/global-search";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chronicles of Aethelgard | AI RPG World Builder",
  description:
    "An AI-assisted campaign builder and lore keeper for tabletop role-playing games.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <UserProvider><GlobalSearch />{children}</UserProvider>
      </body>
    </html>
  );
}
