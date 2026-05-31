import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aether Travel Engine - Dynamic Trip Planner & Experience Optimizer",
  description: "A production-grade, real-time travel planning application with adaptive itinerary scheduling, weather mitigation, and interactive OpenStreetMap visuals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

