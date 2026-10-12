import siteInfo from "@/utils/siteInfo";
import type { Metadata } from "next";
import LayoutComponent from "./LayoutComponent";

export const metadata: Metadata = {
  title: siteInfo.title,
  description: siteInfo.description,
  manifest: "manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
          <LayoutComponent>
            {children}
          </LayoutComponent>
      </body>
    </html>
  );
}
