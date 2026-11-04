import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";

const onest = Onest({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], variable: "--font-onest", display: "swap" });

export const metadata: Metadata = {
  title: "Avrora Store Assistant",
  description: "Today's priorities for your store",
  // iOS reads these when the app is added to the Home Screen (needed for notifications on iPhone).
  appleWebApp: { capable: true, title: "Avrora", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f6f6f7",
  colorScheme: "light",
  // draw under the notch and home indicator; the layout pads with env(safe-area-inset-*)
  viewportFit: "cover",
  // Android: the keyboard shrinks the page so sheets with inputs stay above it
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${onest.variable} h-full antialiased`}>
      <body className="h-full">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
