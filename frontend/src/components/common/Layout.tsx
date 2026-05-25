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
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar handles its own mobile-drawer vs desktop-rail layout */}
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title={title} />
        {/* Tighter padding on mobile, generous on desktop */}
        {/* pb-[72px] on mobile clears the fixed 52px tab bar + env(safe-area-inset-bottom) */}
        <main className="flex-1 p-4 pb-[72px] md:p-6 md:pb-6 lg:p-8 lg:pb-8 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">{children}</main>
      </div>
    </div>
  );
}
