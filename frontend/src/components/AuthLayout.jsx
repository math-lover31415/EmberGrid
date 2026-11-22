import { Grid3X3 } from "lucide-react";

export default function AuthLayout({ children, eyebrow, title, subtitle }) {
  return (
    <main className="auth-shell">
      <header className="auth-brand">
        <span className="brand-mark"><Grid3X3 size={18} strokeWidth={1.8} /></span>
        <span>EMBER GRID</span>
      </header>
      <section className="auth-content">
        <div className="auth-card">{children}</div>
      </section>
      <footer className="auth-footer">
        <span>EMBER GRID</span>
      </footer>
    </main>
  );
}
