import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Avalon Avatar",
  description: "Web-based anime AI companion with Live2D avatar, chat, and voice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
