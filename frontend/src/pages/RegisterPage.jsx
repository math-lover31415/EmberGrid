import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import AuthLayout from "../components/AuthLayout.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await register(email.trim(), password);
      navigate("/", { replace: true });
    } catch (submitError) {
      setError(submitError.message || "Unable to create your account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="FIELD ACCESS · 02"
      title={<>A new perspective<br /><span>starts with you.</span></>}
      subtitle="Create your space and start exploring the landscapes that shape our planet."
    >
      <div className="card-heading">
        <span className="card-kicker">JOIN THE EXPLORATION</span>
        <h2>Create your account</h2>
        <p>One small step toward a wider view.</p>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="register-email">Email address</label>
        <div className="input-wrap">
          <Mail size={17} aria-hidden="true" />
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
          />
        </div>
        <label htmlFor="register-password">Password</label>
        <div className="input-wrap">
          <LockKeyhole size={17} aria-hidden="true" />
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            maxLength={1024}
          />
        </div>
        <label htmlFor="confirm-password">Confirm password</label>
        <div className="input-wrap">
          <LockKeyhole size={17} aria-hidden="true" />
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder="Enter your password again"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={8}
            maxLength={1024}
          />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Create account"}
          {!isSubmitting && <ArrowRight size={17} />}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
      <div className="secure-note"><span /> YOUR EXPLORATION STARTS HERE</div>
    </AuthLayout>
  );
}
