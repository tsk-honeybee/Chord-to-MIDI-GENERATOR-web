import { registerSW } from "virtual:pwa-register";

type PwaListener = () => void;

let isInitialized = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
const refreshListeners = new Set<PwaListener>();

function notifyRefreshListeners() {
  refreshListeners.forEach((listener) => listener());
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
}

export function subscribeToPwaRefresh(listener: PwaListener) {
  refreshListeners.add(listener);

  return () => {
    refreshListeners.delete(listener);
  };
}

export async function applyPwaUpdate() {
  if (!updateServiceWorker) {
    return;
  }

  await updateServiceWorker(true);
}
