import type { Metadata } from "next";
import Script from "next/script"; // Import Script component
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
         {/* Load Cubism Core dari CDN agar praktis untuk tes */}
         <Script 
            src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js" 
            strategy="beforeInteractive" 
         />
      </head>
      <body>{children}</body>
    </html>
  );
}