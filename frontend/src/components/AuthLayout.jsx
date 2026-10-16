import { ArrowUpRight, Orbit } from "lucide-react";

export default function AuthLayout({ children, eyebrow, title, subtitle }) {
  return (
    <main className="auth-shell">
      <div className="auth-stars" aria-hidden="true" />
      <div className="auth-glow auth-glow-one" aria-hidden="true" />
      <div className="auth-glow auth-glow-two" aria-hidden="true" />
      <header className="auth-brand">
        <span className="brand-mark"><Orbit size={19} strokeWidth={1.7} /></span>
        <span>WILDFIRE<span className="brand-accent"> / </span>ATLAS</span>
      </header>
      <section className="auth-content">
        <div className="auth-copy">
          <span className="eyebrow"><span className="status-dot" /> {eyebrow}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <div className="auth-side-note">
            <span className="note-line" />
            <span>Earth is our shared frontier.</span>
            <ArrowUpRight size={15} />
          </div>
        </div>
        <div className="auth-card">{children}</div>
      </section>
      <footer className="auth-footer">
        <span>WILDFIRE ATLAS</span>
        <span>Observe with intention <span className="footer-star">✳</span></span>
      </footer>
    </main>
  );
}
