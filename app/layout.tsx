import "./globals.css";
import type { ReactNode } from "react";
export const metadata = { title: "Amplified Operations Suite", description: "Stable operations rebuild" };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
