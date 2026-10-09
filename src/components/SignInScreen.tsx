import { useState, type FormEvent } from "react";
import { ArrowRight, Fingerprint, LockKeyhole } from "lucide-react";
import { supabase } from "../api";
import { HOUSEHOLD_MEMBERS, memberEmail } from "../household";
import { ProfileAvatar } from "./ProfileAvatar";

export function SignInScreen() {
  const [selectedUsername, setSelectedUsername] = useState<(typeof HOUSEHOLD_MEMBERS)[number]["username"]>(HOUSEHOLD_MEMBERS[0].username);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [error, setError] = useState("");
  const passkeySupported = typeof window !== "undefined" && "PublicKeyCredential" in window;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: memberEmail(selectedUsername),
      password,
    });

    if (signInError) {
      setError("That password is not correct.");
      setSubmitting(false);
    }
  }

  async function handlePasskeySignIn() {
    setPasskeySubmitting(true);
    setError("");
    const { error: passkeyError } = await supabase.auth.signInWithPasskey();

    if (passkeyError) {
      setError(
        passkeyError.message.toLowerCase().includes("abort")
          ? "Passkey sign-in was cancelled."
          : "Passkey sign-in is not available yet. Try your password instead.",
      );
      setPasskeySubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="bg-wash" aria-hidden="true" />
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="sign-in-title">
          <img className="auth-logo" src="/icons/icon-192.png" alt="Bill For Us" />
          <p className="eyebrow">Bill For Us</p>
          <h1 className="auth-title" id="sign-in-title">Who are you?</h1>
          <p className="auth-summary">Choose your profile and enter your password.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <fieldset className="member-picker">
              <legend>Household member</legend>
              <div className="member-picker-grid">
                {HOUSEHOLD_MEMBERS.map((member) => {
                  const selected = member.username === selectedUsername;
                  return (
                    <button
                      className={`member-option${selected ? " selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      key={member.username}
                      onClick={() => setSelectedUsername(member.username)}
                    >
                      <ProfileAvatar name={member.name} />
                      <span>{member.name.split(" ")[0]}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="auth-field">
              <span>Password</span>
              <span className="auth-input">
                <LockKeyhole aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  autoFocus
                />
              </span>
            </label>

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button className="auth-submit" type="submit" disabled={submitting || passkeySubmitting}>
              <span>{submitting ? "Signing in…" : "Sign in"}</span>
              {!submitting && <ArrowRight aria-hidden="true" />}
            </button>
          </form>

          {passkeySupported && (
            <>
              <div className="auth-divider"><span>or</span></div>
              <button
                className="passkey-sign-in"
                type="button"
                onClick={handlePasskeySignIn}
                disabled={submitting || passkeySubmitting}
              >
                <Fingerprint aria-hidden="true" />
                <span>{passkeySubmitting ? "Waiting for passkey…" : "Use a passkey"}</span>
              </button>
            </>
          )}

          <p className="auth-note">Your session stays signed in on this device until you sign out or clear browser data.</p>
        </section>
      </main>
    </div>
  );
}
