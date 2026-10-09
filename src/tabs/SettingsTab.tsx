import { useEffect, useState, type ChangeEvent } from "react";
import type { PasskeyListItem, User } from "@supabase/supabase-js";
import { Camera, Fingerprint, LogOut } from "lucide-react";
import { supabase } from "../api";
import { AppIcon, type AppIconName } from "../components/AppIcon";
import { ProfileAvatar } from "../components/ProfileAvatar";
import type { Theme } from "../theme";
import type { Period } from "../api";

function displayNameFor(user: User) {
  return (
    user.user_metadata.display_name ||
    user.user_metadata.full_name ||
    user.email?.split("@")[0] ||
    "Household member"
  );
}

function settlementLabel(period: Period) {
  const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return `${shortDate(period.start_date)} – ${period.status === "CURRENT" ? "Today" : shortDate(period.end_date)}`;
}

function resizeProfileImage(file: File) {
  return new Promise<Blob>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Please choose a valid image."));
      image.onload = () => {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("Could not prepare that image."));

        const crop = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = (image.naturalWidth - crop) / 2;
        const sourceY = (image.naturalHeight - crop) / 2;
        context.drawImage(image, sourceX, sourceY, crop, crop, 0, 0, size, size);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("Could not prepare that image.")),
          "image/jpeg",
          0.86,
        );
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function SettingsRow({
  icon, tone, label, description, value, valueClass = "",
}: {
  icon: AppIconName;
  tone: string;
  label: string;
  description?: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <li className="settings-row">
      <span className={`settings-icon ${tone}`} aria-hidden="true">
        <AppIcon name={icon} />
      </span>
      <span className="settings-copy">
        <span className="settings-title">{label}</span>
        {description && <span className="settings-subtitle">{description}</span>}
      </span>
      <span className={`settings-value ${valueClass}`}>{value}</span>
    </li>
  );
}

export function SettingsTab({
  theme,
  setTheme,
  memberCount,
  user,
  onUserUpdated,
  periods,
  selectedPeriodId,
  onPeriodChange,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  memberCount: number;
  user: User;
  onUserUpdated: (user: User) => void;
  periods: Period[];
  selectedPeriodId: string;
  onPeriodChange: (periodId: string) => void;
}) {
  const initialName = displayNameFor(user);
  const [name, setName] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [message, setMessage] = useState("");
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [passkeys, setPasskeys] = useState<PasskeyListItem[]>([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState("");
  const passkeySupported = typeof window !== "undefined" && "PublicKeyCredential" in window;

  useEffect(() => setName(displayNameFor(user)), [user]);
  useEffect(() => {
    const nextName = name.trim();
    if (!nextName || nextName === displayNameFor(user)) return;

    setNameStatus("idle");
    const timer = window.setTimeout(async () => {
      setNameStatus("saving");
      const { data, error } = await supabase.auth.updateUser({
        data: { display_name: nextName },
      });

      if (error) setNameStatus("error");
      else if (data.user) {
        onUserUpdated(data.user);
        setNameStatus("saved");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [name, onUserUpdated, user]);
  useEffect(() => {
    const avatarPath = user.user_metadata.avatar_path;
    if (!avatarPath) {
      setAvatarUrl("");
      return;
    }

    supabase.storage.from("avatars").createSignedUrl(avatarPath, 60 * 60 * 24 * 7)
      .then(({ data }) => setAvatarUrl(data?.signedUrl || ""));
  }, [user]);

  useEffect(() => {
    if (!passkeySupported) return;
    supabase.auth.passkey.list().then(({ data }) => setPasskeys(data || []));
  }, [passkeySupported, user.id]);

  async function addPasskey() {
    setPasskeyBusy(true);
    setPasskeyMessage("");
    const { error } = await supabase.auth.registerPasskey();
    if (error) {
      setPasskeyMessage(
        error.message.toLowerCase().includes("abort")
          ? "Passkey setup was cancelled."
          : "Passkey setup is unavailable. Check the Supabase passkey settings.",
      );
    } else {
      const { data } = await supabase.auth.passkey.list();
      setPasskeys(data || []);
      setPasskeyMessage("Passkey added. You can use it the next time you sign in.");
    }
    setPasskeyBusy(false);
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");

    try {
      setMessage("Uploading photo…");
      const resizedImage = await resizeProfileImage(file);
      const avatarPath = `${user.id}/profile.jpg`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(
        avatarPath,
        resizedImage,
        { contentType: "image/jpeg", upsert: true },
      );
      if (uploadError) throw uploadError;

      const { data: updateData, error: updateError } = await supabase.auth.updateUser({
        data: { avatar_path: avatarPath },
      });
      if (updateError) throw updateError;

      const { data: signedData } = await supabase.storage.from("avatars").createSignedUrl(
        avatarPath,
        60 * 60 * 24 * 7,
      );
      setAvatarUrl(signedData?.signedUrl || "");
      if (updateData.user) onUserUpdated(updateData.user);
      setMessage("Profile photo saved.");
    } catch (error) {
      setMessage("Your photo could not be saved. Check the profile storage setup.");
    }

    event.target.value = "";
  }

  return (
    <div className="screen screen--settings">
      <header className="page-header">
        <h1 className="large-title">Settings</h1>
      </header>

      <section className="content-section settings-profile-section" aria-labelledby="profile-settings-heading">
        <div className="section-heading compact">
          <h2 id="profile-settings-heading">Profile</h2>
        </div>
        <div className="profile-settings-card">
          <div className="profile-photo-control">
            <ProfileAvatar name={name || initialName} src={avatarUrl} />
            <label className="profile-camera" aria-label="Choose profile photo" title="Choose profile photo">
              <Camera aria-hidden="true" />
              <input type="file" accept="image/*" onChange={handleImage} />
            </label>
          </div>
          <div className="profile-fields">
            <div className="profile-field-heading">
              <label className="visually-hidden" htmlFor="profile-name">Profile name</label>
              <span className={`profile-save-status status-${nameStatus}`} aria-live="polite">
                {nameStatus === "saving"
                    ? "Saving…"
                    : nameStatus === "saved"
                      ? "Saved"
                      : nameStatus === "error"
                        ? "Could not save"
                        : ""}
              </span>
            </div>
            <input
              id="profile-name"
              aria-label="Profile name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => !name.trim() && setName(initialName)}
              maxLength={48}
            />
            <span className="profile-email">{user.email}</span>
          </div>
        </div>
        {message && <p className="settings-message" role="status">{message}</p>}
      </section>

      <section className="content-section" aria-labelledby="settlement-settings-heading">
        <div className="section-heading compact">
          <h2 id="settlement-settings-heading">Settlement</h2>
        </div>
        <div className="settlement-setting-card">
          <span className="settings-icon tile-blue" aria-hidden="true"><AppIcon name="clock" /></span>
          <label className="settlement-picker-label" htmlFor="settlement-period">View period</label>
          <select id="settlement-period" value={selectedPeriodId} onChange={(event) => onPeriodChange(event.target.value)}>
            {periods.map((period) => <option value={period.id} key={period.id}>{settlementLabel(period)}</option>)}
          </select>
        </div>
      </section>

      <section className="content-section" aria-labelledby="appearance-settings-heading">
        <div className="section-heading compact">
          <h2 id="appearance-settings-heading">Appearance</h2>
        </div>
        <div className="appearance-card">
          <span className="settings-icon tile-purple" aria-hidden="true">
            <AppIcon name={theme === "dark" ? "moon" : "sun"} />
          </span>
          <span className="settings-copy">
            <span className="settings-title">Theme</span>
          </span>
          <div className="theme-options" role="group" aria-label="Theme">
            <button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>Light</button>
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>Dark</button>
          </div>
        </div>
      </section>

      <section className="content-section" aria-labelledby="security-settings-heading">
        <div className="section-heading compact">
          <h2 id="security-settings-heading">Security</h2>
        </div>
        <div className="passkey-card">
          <span className="settings-icon tile-blue" aria-hidden="true">
            <Fingerprint />
          </span>
          <span className="settings-copy">
            <span className="settings-title">Passkeys</span>
            <span className="settings-subtitle">
              {passkeys.length ? `${passkeys.length} saved on your account` : "Use Face ID, fingerprint, or device unlock"}
            </span>
          </span>
          <button type="button" onClick={addPasskey} disabled={!passkeySupported || passkeyBusy}>
            {passkeyBusy ? "Adding…" : passkeys.length ? "Add another" : "Add"}
          </button>
        </div>
        {!passkeySupported && <p className="settings-message">Passkeys are not supported by this browser.</p>}
        {passkeyMessage && <p className="settings-message" role="status">{passkeyMessage}</p>}
      </section>

      <section className="content-section" aria-labelledby="household-settings-heading">
        <div className="section-heading compact">
          <h2 id="household-settings-heading">Household</h2>
        </div>
        <ul className="settings-list">
          <SettingsRow icon="house" tone="tile-red" label="Name" value="Rockdale Homies" />
          <SettingsRow icon="people" tone="tile-green" label="Members" value={memberCount} />
          <SettingsRow icon="dollar" tone="tile-orange" label="Currency" value="AUD ($)" />
        </ul>
      </section>

      <section className="content-section" aria-labelledby="account-settings-heading">
        <div className="section-heading compact">
          <h2 id="account-settings-heading">Account</h2>
        </div>
        <button className="sign-out-button" type="button" onClick={() => supabase.auth.signOut()}>
          <LogOut aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </section>
    </div>
  );
}
