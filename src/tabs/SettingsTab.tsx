import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type PointerEvent } from "react";
import type { PasskeyListItem, User } from "@supabase/supabase-js";
import { Camera, CheckCircle2, ChevronRight, CircleAlert, Clock3, Crop, Fingerprint, LogOut, RefreshCw, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { supabase } from "../api";
import { AppIcon, type AppIconName } from "../components/AppIcon";
import { formatRelativeTime } from "../components/format";
import { ProfileAvatar } from "../components/ProfileAvatar";
import type { Theme } from "../theme";
import type { Period } from "../api";
import { isSyncUiActive, type SyncState } from "../sync";

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

type CropOffset = { x: number; y: number };

function drawProfileCrop(context: CanvasRenderingContext2D, image: HTMLImageElement, size: number, zoom: number, offset: CropOffset) {
  const crop = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  const sourceX = (image.naturalWidth - crop) / 2 - offset.x * (image.naturalWidth - crop) / 2;
  const sourceY = (image.naturalHeight - crop) / 2 - offset.y * (image.naturalHeight - crop) / 2;
  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sourceX, sourceY, crop, crop, 0, 0, size, size);
}

function cropProfileImage(file: Blob, zoom: number, offset: CropOffset) {
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

        drawProfileCrop(context, image, size, zoom, offset);
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
  avatarUrl,
  onAvatarUrlChange,
  onUserUpdated,
  periods,
  selectedPeriodId,
  onPeriodChange,
  onSyncNow,
  syncState,
  online,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  memberCount: number;
  user: User;
  avatarUrl: string;
  onAvatarUrlChange: (url: string) => void;
  onUserUpdated: (user: User) => void;
  periods: Period[];
  selectedPeriodId: string;
  onPeriodChange: (periodId: string) => void;
  onSyncNow: () => Promise<void>;
  syncState: SyncState;
  online: boolean;
}) {
  const initialName = displayNameFor(user);
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState("");
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<{ file: File; previewUrl: string } | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [passkeys, setPasskeys] = useState<PasskeyListItem[]>([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState("");
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const cropDrag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const passkeySupported = typeof window !== "undefined" && "PublicKeyCredential" in window;
  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId)
    || periods.find((period) => period.status === "CURRENT");
  const hasScanField = selectedPeriod && Object.prototype.hasOwnProperty.call(selectedPeriod, "last_scanned_at");
  const relativeScanTime = selectedPeriod?.last_scanned_at
    ? formatRelativeTime(selectedPeriod.last_scanned_at, relativeTimeNow)
    : null;
  const scanLabel = !hasScanField
    ? null
    : selectedPeriod?.last_scanned_at === null
      ? "Never scanned yet"
      : relativeScanTime
        ? `Last scanned: ${relativeScanTime}`
        : null;

  const syncing = isSyncUiActive(syncState);
  const syncButtonLabel = syncing
    ? syncState.stageMessage || "Syncing…"
    : !online
      ? "Offline"
    : syncState.status === "failed"
      ? "Try again"
      : "Sync Now";

  useEffect(() => setName(displayNameFor(user)), [user]);
  useEffect(() => {
    const timer = window.setInterval(() => setRelativeTimeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
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
    if (!profileModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [profileModalOpen]);
  useEffect(() => () => {
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl);
  }, [pendingPhoto]);
  useEffect(() => {
    const source = pendingPhoto?.previewUrl || avatarUrl;
    if (!profileModalOpen || !source) {
      cropImageRef.current = null;
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      cropImageRef.current = image;
      const canvas = cropCanvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && context) drawProfileCrop(context, image, canvas.width, cropZoom, cropOffset);
    };
    image.src = source;
    return () => { cancelled = true; };
  }, [avatarUrl, pendingPhoto?.previewUrl, profileModalOpen]);
  useEffect(() => {
    const canvas = cropCanvasRef.current;
    const image = cropImageRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && image && context) drawProfileCrop(context, image, canvas.width, cropZoom, cropOffset);
  }, [cropOffset, cropZoom]);

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

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    setPendingPhoto({ file, previewUrl: URL.createObjectURL(file) });
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setProfileModalOpen(true);
    event.target.value = "";
  }

  function closeProfileModal() {
    if (photoBusy) return;
    setPendingPhoto(null);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setProfileModalOpen(false);
  }

  function openProfileModal() {
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setProfileModalOpen(true);
  }

  async function saveProfileImage() {
    if (!pendingPhoto && cropZoom === 1) {
      imageInputRef.current?.click();
      return;
    }

    setPhotoBusy(true);
    setMessage("");

    try {
      setMessage("Uploading photo…");
      let sourceImage: Blob | undefined = pendingPhoto?.file;
      if (!sourceImage) sourceImage = await fetch(avatarUrl).then((response) => {
        if (!response.ok) throw new Error("Could not load the current image.");
        return response.blob();
      });
      if (!sourceImage) throw new Error("Choose a photo first.");
      const resizedImage = await cropProfileImage(sourceImage, cropZoom, cropOffset);
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
      const signedUrl = signedData?.signedUrl;
      onAvatarUrlChange(signedUrl ? `${signedUrl}&v=${Date.now()}` : "");
      if (updateData.user) onUserUpdated(updateData.user);
      setMessage("Profile photo saved.");
      setPendingPhoto(null);
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setProfileModalOpen(false);
    } catch (error) {
      setMessage("Your photo could not be saved. Check the profile storage setup.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function deleteProfileImage() {
    const avatarPath = user.user_metadata.avatar_path;
    if (!avatarPath) {
      closeProfileModal();
      setMessage("There is no uploaded photo to remove.");
      return;
    }

    setPhotoBusy(true);
    setMessage("");
    try {
      const { error: removeError } = await supabase.storage.from("avatars").remove([avatarPath]);
      if (removeError) throw removeError;
      const { data, error: updateError } = await supabase.auth.updateUser({ data: { avatar_path: null } });
      if (updateError) throw updateError;
      onAvatarUrlChange("");
      if (data.user) onUserUpdated(data.user);
      setProfileModalOpen(false);
      setMessage("Profile photo removed.");
    } catch (error) {
      setMessage("Your photo could not be removed. Check the profile storage setup.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function startProfileLongPress(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    longPressTriggered.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      openProfileModal();
    }, 550);
  }

  function endProfileLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleCameraClick(event: MouseEvent<HTMLLabelElement>) {
    event.stopPropagation();
    if (!longPressTriggered.current) return;
    event.preventDefault();
    longPressTriggered.current = false;
  }

  function startCropDrag(event: PointerEvent<HTMLButtonElement>) {
    if (cropZoom <= 1 || photoBusy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function moveCrop(event: PointerEvent<HTMLButtonElement>) {
    const drag = cropDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || cropZoom <= 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const maxTravel = Math.max(1, (cropZoom - 1) * bounds.width / 2);
    const deltaX = (event.clientX - drag.x) / maxTravel;
    const deltaY = (event.clientY - drag.y) / maxTravel;
    cropDrag.current = { ...drag, x: event.clientX, y: event.clientY };
    setCropOffset((current) => ({
      x: Math.max(-1, Math.min(1, current.x + deltaX)),
      y: Math.max(-1, Math.min(1, current.y + deltaY)),
    }));
  }

  function endCropDrag(event: PointerEvent<HTMLButtonElement>) {
    if (cropDrag.current?.pointerId === event.pointerId) cropDrag.current = null;
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
          <div
            className="profile-photo-control"
            onPointerDown={startProfileLongPress}
            onPointerUp={endProfileLongPress}
            onPointerCancel={endProfileLongPress}
            onPointerLeave={endProfileLongPress}
            onClick={openProfileModal}
            title="Long press to manage your profile photo"
          >
            <ProfileAvatar name={name || initialName} src={avatarUrl} />
            <label className="profile-camera" aria-label="Choose profile photo" title="Choose profile photo" onClick={handleCameraClick}>
              <Camera aria-hidden="true" />
              <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImage} />
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
        <ul className="settings-list sync-settings-list">
          <li className="settings-row sync-row">
            <span className="settings-icon tile-green" aria-hidden="true">
              <RefreshCw className={syncing ? "sync-spinning" : ""} />
            </span>
            <span className="settings-copy">
              <span className="settings-title">Sync data</span>
              {scanLabel ? (
                <span className="last-scanned-line" role="status">
                  <Clock3 aria-hidden="true" />
                  {scanLabel}
                </span>
              ) : (
                <span className="settings-subtitle">Refresh receipts and settlement</span>
              )}
            </span>
            <button
              className="sync-action-button"
              type="button"
              onClick={() => void onSyncNow()}
              disabled={!online}
              aria-disabled={!online}
              title={!online ? "Connect to the internet to sync" : syncing ? "Reconnect to this running sync" : undefined}
            >
              <span>{syncButtonLabel}</span>
            </button>
            {syncing && (
              <div className="sync-live-stage" role="status" aria-live="polite">
                <span className="sync-live-dot" aria-hidden="true" />
                <span>{syncState.stageMessage || "Syncing…"}</span>
              </div>
            )}
            {(syncState.status === "done" || syncState.status === "failed" || syncState.status === "unreachable") && (
              <div className={`sync-result sync-result--${syncState.status === "done" ? "success" : "error"}`} role={syncState.status === "done" ? "status" : "alert"}>
                {syncState.status === "done" ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                <span>
                  <strong>{syncState.status === "done" ? "Sync complete" : syncState.status === "failed" ? "Sync failed" : "Reconnecting"}</strong>
                  <span>{(syncState.status === "done" ? syncState.resultSummary : syncState.error).replace(/,\s*/g, " · ")}</span>
                </span>
                {syncState.status === "failed" && (
                  <button type="button" className="sync-retry-button" onClick={() => void onSyncNow()}>Try again</button>
                )}
              </div>
            )}
          </li>
        </ul>
        <ul className="settings-list sign-out-settings-list">
          <li className="account-sign-out-item">
            <button className="account-sign-out-button" type="button" onClick={() => supabase.auth.signOut()}>
              <span className="settings-icon tile-red" aria-hidden="true"><LogOut /></span>
              <span className="settings-copy">
                <span className="settings-title">Sign out</span>
                <span className="settings-subtitle">End session on this device</span>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>

      {profileModalOpen && (
        <div className="profile-modal-backdrop" role="presentation" onClick={closeProfileModal}>
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-photo-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-header">
              <div>
                <p className="profile-modal-kicker">Profile photo</p>
                <h2 id="profile-photo-modal-title">Edit your picture</h2>
              </div>
              <div className="profile-modal-header-actions">
                <button className="profile-modal-delete" type="button" aria-label="Delete profile photo" title="Delete photo" onClick={deleteProfileImage} disabled={photoBusy || !user.user_metadata.avatar_path}><Trash2 aria-hidden="true" /></button>
                <button className="profile-modal-close" type="button" aria-label="Close photo editor" onClick={closeProfileModal} disabled={photoBusy}><X aria-hidden="true" /></button>
              </div>
            </div>
            <button
              className={`profile-crop-stage${cropZoom > 1 ? " can-pan" : ""}`}
              type="button"
              onClick={() => cropZoom <= 1 && imageInputRef.current?.click()}
              onPointerDown={startCropDrag}
              onPointerMove={moveCrop}
              onPointerUp={endCropDrag}
              onPointerCancel={endCropDrag}
              aria-label={cropZoom > 1 ? "Drag to reposition profile photo" : "Choose a different profile photo"}
              disabled={photoBusy}
            >
              {(pendingPhoto?.previewUrl || avatarUrl) ? (
                <canvas ref={cropCanvasRef} width="512" height="512" aria-hidden="true" />
              ) : (
                <ProfileAvatar name={name || initialName} />
              )}
              <span className="profile-crop-guide" aria-hidden="true" />
            </button>
            <div className="profile-zoom-control">
              <ZoomOut aria-hidden="true" />
              <input type="range" min="1" max="2.5" step="0.01" value={cropZoom} onChange={(event) => {
                const nextZoom = Number(event.target.value);
                setCropZoom(nextZoom);
                if (nextZoom === 1) setCropOffset({ x: 0, y: 0 });
              }} aria-label="Photo zoom" disabled={photoBusy || (!pendingPhoto && !avatarUrl)} />
              <ZoomIn aria-hidden="true" />
            </div>
            <p className="profile-modal-help">Zoom, then drag the photo to centre your face inside the circle.</p>
            <div className="profile-modal-actions">
              <button className="profile-modal-primary" type="button" onClick={saveProfileImage} disabled={photoBusy}>
                <Crop aria-hidden="true" />
                {photoBusy ? "Saving…" : pendingPhoto || cropZoom !== 1 ? "Save crop" : "Choose new photo"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
