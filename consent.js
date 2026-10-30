// ECIS 129.9 — consentimiento analítico + Google Analytics 4 + Microsoft Clarity
// Implementación básica: GA4 y Clarity NO se cargan antes del consentimiento.

(() => {
  'use strict';

  const GA_ID = 'G-HVW0S36Z6E';
  const CLARITY_ID = 'z5x7zpm7he';
  const CONSENT_KEY = 'ecis_analytics_consent_v2';
  const CONSENT_ACCEPTED = 'accepted';
  const CONSENT_DENIED = 'denied';
  let gaRequested = false;
  let clarityRequested = false;

  function getStoredConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
  }

  function setStoredConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
  }

  function ensureDataLayer() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  }

  function setConsentDefault() {
    ensureDataLayer();
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      personalization_storage: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted'
    });
  }

  function loadGA4() {
    if (gaRequested) return;
    gaRequested = true;

    setConsentDefault();
    window.gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, {
      send_page_view: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    script.dataset.ecisAnalytics = 'ga4';
    document.head.appendChild(script);
  }

  function ensureClarityQueue() {
    window.clarity = window.clarity || function(){
      (window.clarity.q = window.clarity.q || []).push(arguments);
    };
  }

  function loadClarity() {
    if (clarityRequested) return;
    clarityRequested = true;

    ensureClarityQueue();
    // ECIS usa Clarity solo con fines analíticos; publicidad permanece denegada.
    window.clarity('consentv2', {
      ad_Storage: 'denied',
      analytics_Storage: 'granted'
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_ID)}`;
    script.dataset.ecisAnalytics = 'clarity';
    document.head.appendChild(script);
  }

  function disableClarity() {
    if (!window.clarity) return;
    window.clarity('consentv2', {
      ad_Storage: 'denied',
      analytics_Storage: 'denied'
    });
  }

  function disableGA4() {
    if (window.gtag) {
      window.gtag('consent', 'update', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied'
      });
    }
    // Elimina cookies de Analytics accesibles desde este dominio si existieran.
    try {
      document.cookie.split(';').forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        if (name === '_ga' || name.startsWith('_ga_')) {
          document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
        }
      });
    } catch (_) {}
  }

  function hideBanner() {
    document.querySelector('#ecis-consent-banner')?.remove();
  }

  function acceptAnalytics() {
    setStoredConsent(CONSENT_ACCEPTED);
    loadGA4();
    loadClarity();
    hideBanner();
  }

  function declineAnalytics() {
    setStoredConsent(CONSENT_DENIED);
    disableGA4();
    disableClarity();
    hideBanner();
  }

  function showBanner({ force = false } = {}) {
    if (document.querySelector('#ecis-consent-banner')) return;
    if (!force && getStoredConsent()) return;

    const banner = document.createElement('section');
    banner.id = 'ecis-consent-banner';
    banner.className = 'ecis-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Preferencias de privacidad');
    banner.innerHTML = `
      <div class="ecis-consent__inner">
        <div class="ecis-consent__copy">
          <p class="ecis-consent__eyebrow">PRIVACIDAD</p>
          <p class="ecis-consent__title">Analíticas opcionales</p>
          <p class="ecis-consent__text">ECIS puede usar Google Analytics y Microsoft Clarity para conocer cómo se utiliza el sitio y mejorar Aula ECIS. Estas analíticas se activan únicamente si las aceptás.</p>
          <a class="ecis-consent__link" href="privacidad.html">Ver política de privacidad</a>
        </div>
        <div class="ecis-consent__actions">
          <button class="button button-outline ecis-consent__button" type="button" data-consent="necessary">Solo necesarias</button>
          <button class="button button-primary ecis-consent__button" type="button" data-consent="analytics">Aceptar analíticas</button>
        </div>
      </div>`;

    banner.querySelector('[data-consent="necessary"]')?.addEventListener('click', declineAnalytics);
    banner.querySelector('[data-consent="analytics"]')?.addEventListener('click', acceptAnalytics);
    document.body.appendChild(banner);
  }

  function addPrivacyPreferencesControl() {
    const footerNav = document.querySelector('.footer-links');
    if (!footerNav || footerNav.querySelector('.js-privacy-settings')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'footer-privacy-settings js-privacy-settings';
    button.textContent = 'Preferencias de privacidad';
    button.addEventListener('click', () => showBanner({ force: true }));
    footerNav.appendChild(button);
  }

  function analyticsAllowed() {
    return getStoredConsent() === CONSENT_ACCEPTED;
  }

  window.ecisTrack = (eventName, params = {}) => {
    if (!analyticsAllowed()) return;
    loadGA4();
    window.gtag?.('event', eventName, params);
  };

  function bindGoalTracking() {
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link || !analyticsAllowed()) return;
      const href = link.getAttribute('href') || '';
      if (href === 'experiencias.html') {
        window.ecisTrack('aula_ecis_click', {
          link_text: (link.textContent || '').trim().slice(0, 100),
          page_path: window.location.pathname
        });
      } else if (href === 'masterclass.html') {
        window.ecisTrack('masterclass_click', {
          link_text: (link.textContent || '').trim().slice(0, 100),
          page_path: window.location.pathname
        });
      } else if (href.startsWith('inscripcion.html')) {
        window.ecisTrack('begin_registration_click', {
          page_path: window.location.pathname
        });
      }
    }, { passive: true });
  }

  const stored = getStoredConsent();
  if (stored === CONSENT_ACCEPTED) {
    loadGA4();
    loadClarity();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      addPrivacyPreferencesControl();
      bindGoalTracking();
      if (!stored) showBanner();
    }, { once: true });
  } else {
    addPrivacyPreferencesControl();
    bindGoalTracking();
    if (!stored) showBanner();
  }
})();
