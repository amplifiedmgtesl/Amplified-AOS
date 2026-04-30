import "./globals.css";
import type { ReactNode } from "react";
import { StoreProvider } from "../components/layout/store-provider";
import { EnvBanner } from "../components/layout/env-banner";

export const metadata = { title: "Amplified Operations Suite", description: "Stable operations rebuild" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EnvBanner />
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
