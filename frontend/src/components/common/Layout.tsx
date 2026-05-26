import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

interface LayoutProps {
  title: string;
  children: ReactNode;
}

// SSEProvider (mounted at app root) owns the single EventSource connection.
// Do NOT call useSSE here — it would open a SECOND connection per page.
export default function Layout({ title, children }: LayoutProps) {
  return (
    <div className="h-screen flex md:p-2 md:gap-2 overflow-hidden">
      {/* Sidebar handles its own mobile-drawer vs desktop-rail layout */}
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden md:gap-2">
        <Header title={title} />
        {/* Tighter padding on mobile, generous on desktop */}
        {/* pb-24 on mobile adds clearance below floating bottom pill (pill height + safe-area) */}
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6 lg:p-8 lg:pb-8 overflow-y-auto [overflow-x:clip] [scrollbar-gutter:stable]">{children}</main>
      </div>
    </div>
  );
}
