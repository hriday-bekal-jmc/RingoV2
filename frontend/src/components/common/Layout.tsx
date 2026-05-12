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
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
