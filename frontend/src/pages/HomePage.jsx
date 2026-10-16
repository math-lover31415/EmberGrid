import { lazy, Suspense, useState } from "react";
import { LogOut, Moon, Orbit, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const MapExplorer = lazy(() => import("../components/MapExplorer.jsx"));

export default function HomePage() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState("dark");
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
        <Link className="atlas-brand" to="/" aria-label="Wildfire Atlas home">
          <span className="brand-mark"><Orbit size={18} /></span>
          <span>WILDFIRE<span className="brand-accent"> / </span>ATLAS</span>
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
