import "./globals.css";
import type { ReactNode } from "react";
import { SupabaseBootstrap } from "@/components/shared/supabase-bootstrap";

export const metadata = { title: "Amplified Operations Suite", description: "Stable operations rebuild" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SupabaseBootstrap />
        {children}
      </body>
    </html>
  );
}
