type AnalyticsValue = string | number | boolean;
type AnalyticsData = Record<string, AnalyticsValue>;

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const measurementId = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim();
let initialized = false;

export function initializeAnalytics(): void {
  if (initialized || !measurementId || typeof window === "undefined") return;

  try {
    initialized = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || ((...args: unknown[]) => {
      window.dataLayer?.push(args);
    });

    if (!document.querySelector(`script[data-jobsoxo-ga="${measurementId}"]`)) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      script.dataset.jobsoxoGa = measurementId;
      document.head.appendChild(script);
    }

    window.gtag("js", new Date());
    window.gtag("config", measurementId, { anonymize_ip: true });
  } catch {
    // Analytics must never affect the application.
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === "undefined" || !measurementId) return;

  try {
    initializeAnalytics();
    window.gtag?.("event", name, data);
  } catch {
    // Analytics must never affect the application.
  }
}

export type { AnalyticsData, AnalyticsValue };