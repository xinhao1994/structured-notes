// Dedicated admin layout — ISOLATED from the SN Desk app.
// No Header, no BottomNav, no SwipeNavigator, no VisitTracker.
// This page is for the admin to watch who's using the app; it must not
// show the Desk/Pocket/Calculator/Analyze/Chat navigation itself.

import "../globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata = {
  title: "SN Desk — Admin Dashboard",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('snd.theme');if(t!=='light')document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text)]">
        <ThemeProvider>
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
