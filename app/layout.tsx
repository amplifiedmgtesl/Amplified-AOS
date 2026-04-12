import "./globals.css";
import type { ReactNode } from "react";
import { StoreProvider } from "../components/layout/store-provider";

export const metadata = { title: "Amplified Operations Suite", description: "Stable operations rebuild" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
