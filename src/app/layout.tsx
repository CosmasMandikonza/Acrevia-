import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Acrevia — From land to possibility",
    template: "%s | Acrevia",
  },
  description:
    "A workspace for exploring the possibilities of faith-owned land, with mission and evidence at its heart.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
