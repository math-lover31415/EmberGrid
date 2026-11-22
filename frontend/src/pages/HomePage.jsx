import { lazy, Suspense, useState } from "react";
import { Grid3X3, LogOut, Moon, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const MapExplorer = lazy(() => import("../components/MapExplorer.jsx"));

export default function HomePage() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState("light");
  const [logoutError, setLogoutError] = useState("");

  async function handleLogout() {
    setLogoutError("");
    try {
      await logout();
    } catch (error) {
      setLogoutError(error.message);
    }
  }

  return (
    <main className={`atlas-shell theme-${theme}`}>
      <header className="atlas-topbar">
        <Link className="atlas-brand" to="/" aria-label="Ember Grid home">
          <span className="brand-mark"><Grid3X3 size={18} /></span>
          <span>EMBER GRID</span>
        </Link>
        <div className="topbar-meta">
          <span className="live-indicator"><i /> GLOBAL VIEW</span>
          <span className="topbar-divider" />
          <span className="user-email">{user?.email}</span>
          <button
            className="icon-button theme-toggle"
            type="button"
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button className="icon-button logout-button" type="button" onClick={handleLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      {logoutError && <div className="logout-notice" role="alert">{logoutError}</div>}
      <Suspense
        fallback={
          <div className="map-lazy-fallback" aria-label="Loading map engine">
            <span className="loading-orbit" />
            <span>Loading map engine</span>
          </div>
        }
      >
        <MapExplorer theme={theme} />
      </Suspense>
    </main>
  );
}
