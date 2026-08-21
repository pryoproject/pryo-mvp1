import "./globals.css";
import "./market.css";
export const metadata = { title: "Pryo Market Snapshot", description: "Know what matters first." };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
