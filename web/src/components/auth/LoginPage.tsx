import { useState } from "react";
import { supabase } from "../../lib/supabase";

type Mode = "signin" | "signup";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    if (mode === "signin") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) setError(authError.message);
    } else {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName } }
      });
      if (authError) {
        setError(authError.message);
      } else {
        setInfo("Check your email for a confirmation link, then sign in.");
        switchMode("signin");
      }
    }

    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="workspace-logo auth-logo">Cellor Workspace</h1>
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab${mode === "signin" ? " is-active" : ""}`}
            onClick={() => switchMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`auth-tab${mode === "signup" ? " is-active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            Sign up
          </button>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "signup" ? (
            <div className="auth-row">
              <label className="auth-label">
                First name
                <input
                  className="auth-input"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </label>
              <label className="auth-label">
                Last name
                <input
                  className="auth-input"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </label>
            </div>
          ) : null}
          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : undefined}
            />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {info ? <p className="auth-info" role="status">{info}</p> : null}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create account" : "Sign in")}
          </button>
        </form>
      </div>
    </div>
  );
}
