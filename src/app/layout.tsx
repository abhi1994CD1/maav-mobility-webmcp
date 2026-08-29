import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus Mobility Recovery Command",
  description:
    "A human-governed simulated mobility recovery command center powered by browser-native WebMCP tools.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
