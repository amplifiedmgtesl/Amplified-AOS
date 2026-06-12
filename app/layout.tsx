import "./globals.css";
import type { ReactNode } from "react";
import { StoreProvider } from "../components/layout/store-provider";
import { EnvBanner } from "../components/layout/env-banner";
import { UpdateBanner } from "../components/layout/update-banner";

export const metadata = { title: "Amplified Operations Suite", description: "Stable operations rebuild" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EnvBanner />
        <UpdateBanner />
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
