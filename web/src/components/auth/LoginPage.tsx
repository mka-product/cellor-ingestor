import { useState } from "react";
import { apiBasePath } from "../../infrastructure/apiBase";
import { S3StatusIndicator } from "../S3StatusIndicator";
import { useAuth } from "./AuthContext";

type Mode = "signin" | "signup";

export function LoginPage() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const body = new URLSearchParams({ username: email, password });
        const res = await fetch(`${apiBasePath()}/auth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { detail?: string };
          setError(data.detail ?? "Invalid credentials");
        } else {
          const data = await res.json() as { access_token: string; user: { id: string; email: string; first_name: string; last_name: string } };
          signIn(data.access_token, data.user);
        }
      } else {
        const res = await fetch(`${apiBasePath()}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { detail?: string };
          setError(data.detail ?? "Signup failed");
        } else {
          const data = await res.json() as { access_token: string; user: { id: string; email: string; first_name: string; last_name: string } };
          signIn(data.access_token, data.user);
        }
      }
    } catch {
      setError("Network error, please try again");
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
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create account" : "Sign in")}
          </button>
        </form>
        <div className="auth-storage">
          <S3StatusIndicator />
        </div>
      </div>
    </div>
  );
}
