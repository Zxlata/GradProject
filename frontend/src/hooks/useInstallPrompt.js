/**
 * useInstallPrompt
 * ─────────────────────────────────────────────────────────────────────────────
 * Captures the browser's `beforeinstallprompt` event so the app can show a
 * custom "Install" CTA instead of the default browser banner.
 *
 * Returns:
 *   isInstallable  — true once the prompt is ready to be shown
 *   isInstalled    — true when the app is running in standalone / PWA mode
 *   isInstalling   — true during the prompt / install animation
 *   promptInstall  — call this to trigger the native install dialog
 *   dismissPrompt  — hide the custom CTA without installing
 */

import { useState, useEffect, useCallback } from 'react';

const DISMISSED_KEY = 'pwa-install-dismissed';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||           // iOS Safari
    document.referrer.startsWith('android-app://')
  );
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable]   = useState(false);
  const [isInstalled,   setIsInstalled]     = useState(isStandalone);
  const [isInstalling,  setIsInstalling]    = useState(false);
  const [isDismissed,   setIsDismissed]     = useState(
    () => sessionStorage.getItem(DISMISSED_KEY) === 'true'
  );

  useEffect(() => {
    // Already installed — nothing to do
    if (isStandalone()) {
      setIsInstalled(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();           // stop browser mini-infobar
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Detect when the user installs via browser UI (not our CTA)
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      console.log('[PWA] App installed successfully.');
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    setIsInstalling(true);
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setIsInstallable(false);
        console.log('[PWA] User accepted the install prompt.');
      } else {
        console.log('[PWA] User dismissed the install prompt.');
      }
    } catch (err) {
      console.error('[PWA] Install prompt error:', err);
    } finally {
      setDeferredPrompt(null);
      setIsInstalling(false);
    }
  }, [deferredPrompt]);

  const dismissPrompt = useCallback(() => {
    setIsInstallable(false);
    setIsDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, 'true');
  }, []);

  return {
    isInstallable: isInstallable && !isDismissed && !isInstalled,
    isInstalled,
    isInstalling,
    promptInstall,
    dismissPrompt,
  };
}

export default useInstallPrompt;
