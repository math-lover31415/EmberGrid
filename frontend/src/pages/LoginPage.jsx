import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import AuthLayout from "../components/AuthLayout.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate("/", { replace: true });
    } catch (submitError) {
      setError(submitError.message || "Unable to sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="FIELD ACCESS · 01"
      title={<>See the world<br /><span>in a new light.</span></>}
      subtitle="A clearer view of the landscapes we depend on starts here."
    >
      <div className="card-heading">
        <span className="card-kicker">WELCOME BACK</span>
        <h2>Sign in to your atlas</h2>
        <p>Enter your credentials to continue your journey.</p>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="login-email">Email address</label>
        <div className="input-wrap">
          <Mail size={17} aria-hidden="true" />
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
          />
        </div>
        <label htmlFor="login-password">Password</label>
        <div className="input-wrap">
          <LockKeyhole size={17} aria-hidden="true" />
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={1024}
          />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in..." : "Enter the atlas"}
          {!isSubmitting && <ArrowRight size={17} />}
        </button>
      </form>
      <p className="auth-switch">
        New to the atlas? <Link to="/register">Create an account</Link>
      </p>
      <div className="secure-note"><span /> SECURE SESSION · ENCRYPTED IN TRANSIT</div>
    </AuthLayout>
  );
}
