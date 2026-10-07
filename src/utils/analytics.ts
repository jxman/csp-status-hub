const GA_MEASUREMENT_ID = 'G-2HLT4VSZHW';
const PROD_HOSTNAME = 'cloudstatus.synepho.com';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

function isProdHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === PROD_HOSTNAME;
}

let initialized = false;

/** Loads GA4 only on the production dashboard host — skips localhost, Vercel previews, /admin, /manage. */
export function initAnalytics(): void {
  if (initialized || !isProdHost()) return;
  initialized = true;

  window.dataLayer = window.dataLayer || [];
  // Must push the `arguments` object, not a rest-param array: gtag.js
  // silently ignores plain arrays in dataLayer, so no hits are ever sent.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!isProdHost() || typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}
