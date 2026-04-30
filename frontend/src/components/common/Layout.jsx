import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';

export default function Layout({ title, children }) {
  return (
    <div className="min-h-screen flex bg-cream-100">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header title={title} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
