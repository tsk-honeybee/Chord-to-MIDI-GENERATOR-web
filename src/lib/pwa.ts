import { registerSW } from "virtual:pwa-register";

type PwaListener = () => void;
type PwaInstallListener = (state: PwaInstallState) => void;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

export type PwaManualInstallMode =
  | "ios-safari"
  | "macos-safari"
  | null;
export type PwaBrowserFamily = "chromium" | "safari" | "other";

interface NavigatorWithRelatedApps extends Navigator {
  getInstalledRelatedApps?: () => Promise<Array<{
    id?: string;
    platform: string;
    url?: string;
    version?: string;
  }>>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export interface PwaInstallState {
  canInstall: boolean;
  isInstalled: boolean;
  manualInstallMode: PwaManualInstallMode;
  browserFamily: PwaBrowserFamily;
}

let isInitialized = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
const refreshListeners = new Set<PwaListener>();
const installListeners = new Set<PwaInstallListener>();
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installedRelatedAppDetected = false;
let installState: PwaInstallState = {
  canInstall: false,
  isInstalled: false,
  manualInstallMode: null,
  browserFamily: "other",
};

function notifyRefreshListeners() {
  refreshListeners.forEach((listener) => listener());
}

function notifyInstallListeners() {
  installListeners.forEach((listener) => listener(installState));
}

function isStandaloneMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true
  );
}

function isSafariBrowser() {
  if (typeof window === "undefined") {
    return false;
  }

  const userAgent = window.navigator.userAgent;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS|FxiOS|Firefox/i.test(userAgent);
}

function isChromiumBrowser() {
  if (typeof window === "undefined") {
    return false;
  }

  const userAgent = window.navigator.userAgent;
  return /Chrome|Chromium|CriOS|Edg|EdgiOS/i.test(userAgent) && !/OPR|OPiOS|FxiOS|Firefox/i.test(userAgent);
}

function detectBrowserFamily(): PwaBrowserFamily {
  if (isSafariBrowser()) {
    return "safari";
  }

  if (isChromiumBrowser()) {
    return "chromium";
  }

  return "other";
}

function isIosDevice() {
  if (typeof window === "undefined") {
    return false;
  }

  const { userAgent, platform, maxTouchPoints } = window.navigator;
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

function detectManualInstallMode(): PwaManualInstallMode {
  if (typeof window === "undefined" || isStandaloneMode()) {
    return null;
  }

  if (isSafariBrowser()) {
    if (isIosDevice()) {
      return "ios-safari";
    }

    return /Macintosh|Mac OS X/i.test(window.navigator.userAgent) ? "macos-safari" : null;
  }

  return null;
}

function syncInstallState() {
  const nextState = {
    canInstall: deferredInstallPrompt !== null && !isStandaloneMode(),
    isInstalled: isStandaloneMode() || installedRelatedAppDetected,
    manualInstallMode: detectManualInstallMode(),
    browserFamily: detectBrowserFamily(),
  };

  if (
    nextState.canInstall === installState.canInstall &&
    nextState.isInstalled === installState.isInstalled &&
    nextState.manualInstallMode === installState.manualInstallMode &&
    nextState.browserFamily === installState.browserFamily
  ) {
    return;
  }

  installState = nextState;
  notifyInstallListeners();
}

async function probeInstalledRelatedApps() {
  if (typeof window === "undefined") {
    return;
  }

  const navigatorWithRelatedApps = window.navigator as NavigatorWithRelatedApps;
  if (!navigatorWithRelatedApps.getInstalledRelatedApps) {
    return;
  }

  try {
    const relatedApps = await navigatorWithRelatedApps.getInstalledRelatedApps();
    const manifestUrl = new URL("manifest.webmanifest", window.location.href).href;
    const manifestId = new URL(".", window.location.href).pathname;

    installedRelatedAppDetected = relatedApps.some((app) => {
      if (app.platform !== "webapp") {
        return false;
      }

      if (app.id && app.id === manifestId) {
        return true;
      }

      return app.url ? new URL(app.url, window.location.href).href === manifestUrl : false;
    });
  } catch (error) {
    console.error(error);
    installedRelatedAppDetected = false;
  } finally {
    syncInstallState();
  }
}

export function initializePwaRegistration() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      notifyRefreshListeners();
    },
  });

  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    syncInstallState();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    syncInstallState();
  });

  const displayModeQuery = window.matchMedia("(display-mode: standalone)");
  const handleDisplayModeChange = () => {
    syncInstallState();
  };

  displayModeQuery.addEventListener("change", handleDisplayModeChange);

  syncInstallState();
  void probeInstalledRelatedApps();
}

export function subscribeToPwaRefresh(listener: PwaListener) {
  refreshListeners.add(listener);

  return () => {
    refreshListeners.delete(listener);
  };
}

export function subscribeToPwaInstallState(listener: PwaInstallListener) {
  installListeners.add(listener);
  listener(installState);

  return () => {
    installListeners.delete(listener);
  };
}

export async function requestPwaInstall() {
  const prompt = deferredInstallPrompt;
  if (!prompt || installState.isInstalled) {
    syncInstallState();
    return "unavailable" as const;
  }

  deferredInstallPrompt = null;
  syncInstallState();
  await prompt.prompt();

  const choice = await prompt.userChoice;
  if (choice.outcome !== "accepted") {
    syncInstallState();
  }

  return choice.outcome;
}

export async function applyPwaUpdate() {
  if (!updateServiceWorker) {
    return;
  }

  await updateServiceWorker(true);
}
