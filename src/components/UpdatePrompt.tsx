import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

type VersionResponse = { version?: string };

const VERSION_CHECK_MS = 5 * 60 * 1000;

export function UpdatePrompt() {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const currentVersionRef = useRef<string | null>(null);
  const dismissedVersionRef = useRef<string | null>(null);
  const reloadStartedRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let cancelled = false;
    let timer: number | null = null;

    function offer(version: string) {
      if (!cancelled && version !== currentVersionRef.current && version !== dismissedVersionRef.current) {
        setAvailableVersion(version);
      }
    }

    async function checkVersion(registration?: ServiceWorkerRegistration) {
      try {
        const response = await fetch(`/version.json?check=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as VersionResponse;
        if (!payload.version) return;
        if (!currentVersionRef.current) {
          currentVersionRef.current = payload.version;
        } else if (payload.version !== currentVersionRef.current) {
          offer(payload.version);
        }
      } catch {
        // Version checks are best-effort and must not interrupt the app.
      }

      try {
        await registration?.update();
        if (registration?.waiting) offer("pending-update");
      } catch {
        // A later visibility or interval check can retry the update.
      }
    }

    function watchRegistration(registration: ServiceWorkerRegistration) {
      registrationRef.current = registration;
      if (registration.waiting && navigator.serviceWorker.controller) offer("pending-update");
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            offer("pending-update");
          }
        });
      });
    }

    void checkVersion();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (cancelled) return;
        watchRegistration(registration);
        void checkVersion(registration);
      });
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkVersion(registrationRef.current || undefined);
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    timer = window.setInterval(() => void checkVersion(registrationRef.current || undefined), VERSION_CHECK_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", checkWhenVisible);
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  async function applyUpdate() {
    setApplying(true);
    const registration = registrationRef.current;
    try {
      await registration?.update();
      if (registration?.waiting) {
        const reload = () => {
          if (reloadStartedRef.current) return;
          reloadStartedRef.current = true;
          window.location.reload();
        };
        navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
        window.setTimeout(reload, 2500);
        return;
      }
    } catch {
      // Fall through to a hard reload, which can still pick up the new build.
    }
    window.location.reload();
  }

  if (!import.meta.env.PROD || !availableVersion) return null;

  return (
    <div className="update-prompt-layer" role="presentation">
      <section className="update-prompt" role="alertdialog" aria-modal="true" aria-labelledby="update-prompt-title">
        <div className="update-prompt-icon" aria-hidden="true"><RefreshCw /></div>
        <div className="update-prompt-copy">
          <h2 id="update-prompt-title">Update available</h2>
          <p>A newer version of SplitMate is ready. Update now to get the latest improvements.</p>
        </div>
        <button className="update-prompt-primary" type="button" onClick={() => void applyUpdate()} disabled={applying}>
          {applying ? "Updating…" : "Update now"}
        </button>
        <button
          className="update-prompt-dismiss"
          type="button"
          aria-label="Dismiss update notice"
          onClick={() => {
            dismissedVersionRef.current = availableVersion;
            setAvailableVersion(null);
          }}
          disabled={applying}
        >
          <X aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
