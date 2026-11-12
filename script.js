// =========================================================
// ECIS 132.0 — flujo rápido y robusto
// Base visual/textual pre-106 + movimiento sutil, acciones claras y tolerancia de red adaptativa
// =========================================================

const ECIS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwm5voUlP5k02F-bNalKUkUknY2SvKe6PVpgOivqn8z0zKPKHNzGmII0UNxJLfljTkp/exec';
const ECIS_STORAGE_KEY = 'ecis_enrollment_draft';
const ECIS_RESULT_KEY = 'ecis_enrollment_result';
const ECIS_REGISTRATION_ATTEMPT_PREFIX = 'ecis_registration_attempt_';
const ECIS_PAYMENT_STAGE_KEY = 'ecis_payment_stage';
const ECIS_EXPERIENCES_CACHE_KEY = 'ecis_experiences_cache_v8';
const ECIS_EXPERIENCES_CACHE_TTL = 5 * 60 * 1000;
const ECIS_WHATSAPP = '5491173445804';
const ECIS_EMAIL = 'ecis.ar.edu@gmail.com';
const ECIS_MAX_AMOUNT = 1000000000;

// Mercado Pago se configura desde la pestaña Experiencias.
// El link y el QR quedan congelados en cada inscripción para preservar el importe histórico.

// =========================================================
// Utilidades generales
// =========================================================

document.querySelectorAll('#year').forEach(el => {
  el.textContent = new Date().getFullYear();
});

function isSensitiveStorageKey(key) {
  return [ECIS_STORAGE_KEY, ECIS_RESULT_KEY, ECIS_PAYMENT_STAGE_KEY].includes(key) || String(key || '').startsWith(ECIS_REGISTRATION_ATTEMPT_PREFIX);
}

function readJsonStorage(key) {
  try {
    let raw = sessionStorage.getItem(key);
    if (!raw && isSensitiveStorageKey(key)) {
      // Compatibilidad con versiones anteriores: migramos y eliminamos el dato personal persistente.
      raw = localStorage.getItem(key);
      if (raw) {
        sessionStorage.setItem(key, raw);
        localStorage.removeItem(key);
      }
    } else if (!raw) {
      raw = localStorage.getItem(key);
    }
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJsonStorage(key, value) {
  const raw = JSON.stringify(value);
  if (isSensitiveStorageKey(key)) {
    try { sessionStorage.setItem(key, raw); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
    return;
  }
  try { localStorage.setItem(key, raw); } catch (_) {}
}

function removeStorage(key) {
  try { localStorage.removeItem(key); } catch (_) {}
  try { sessionStorage.removeItem(key); } catch (_) {}
}

function clearRegistrationAttempts() {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(ECIS_REGISTRATION_ATTEMPT_PREFIX)) localStorage.removeItem(key);
    });
  } catch (_) {}
}

function createRegistrationAttemptId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const r = Math.random() * 16 | 0;
    const v = char === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getRegistrationAttemptId(method) {
  const suffix = String(method || 'registro').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const key = ECIS_REGISTRATION_ATTEMPT_PREFIX + suffix;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;

    // Compatibilidad con la versión 103: si el intento quedó en sessionStorage,
    // lo migramos para poder recuperar el código ya generado.
    const legacy = sessionStorage.getItem(key);
    if (legacy) {
      localStorage.setItem(key, legacy);
      return legacy;
    }

    const created = createRegistrationAttemptId();
    localStorage.setItem(key, created);
    return created;
  } catch (_) {
    return createRegistrationAttemptId();
  }
}

function isValidEcisAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= ECIS_MAX_AMOUNT;
}

function formatArs(value) {
  const number = Number(value);
  if (!isValidEcisAmount(number)) return '—';
  return `$ ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(number)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setError(element, message) {
  if (!element) return;
  element.textContent = message || '';
  element.hidden = !message;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function isLowPowerDevice() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = Boolean(connection?.saveData);
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  return saveData || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4) || prefersReducedMotion();
}

if (isLowPowerDevice()) document.documentElement.classList.add('ecis-low-power');


function smoothScrollTo(element, block = 'start') {
  if (!element) return;
  const header = document.querySelector('.site-header');
  const headerHeight = header ? header.getBoundingClientRect().height : 0;
  const rect = element.getBoundingClientRect();
  const target = window.scrollY + rect.top - headerHeight - 16;
  window.scrollTo({
    top: Math.max(0, target),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth'
  });
}

function getEnrollmentFullName(data) {
  return [data?.nombre, data?.apellido]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function getMpLinkConfig(data) {
  if (!data) return null;
  const experience = findExperience?.(data.experienciaId) || null;
  const url = String(data.mercadoPagoUrl || data.mpUrl || experience?.mercadoPagoUrl || '').trim();
  const qr = String(data.mercadoPagoQr || data.mpQr || experience?.mercadoPagoQr || '').trim();
  if (!url) return null;
  return { url, qr };
}

function getNetworkProfile() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  const saveData = Boolean(connection?.saveData);
  const rtt = Number(connection?.rtt || 0);
  const downlink = Number(connection?.downlink || 0);

  const slow = saveData || effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g' || (rtt > 650 && rtt > 0) || (downlink > 0 && downlink < 1.2);
  const fast = !slow && effectiveType === '4g' && (rtt === 0 || rtt <= 180) && (downlink === 0 || downlink >= 4);

  // Los límites solo determinan cuándo reintentar una consulta individual.
  // Una respuesta rápida avanza inmediatamente; una señal lenta dispone de
  // una ventana amplia para recuperar el mismo registro sin duplicarlo.
  return {
    requestTimeout: slow ? 12000 : (fast ? 4500 : 8000),
    registrationWindow: slow ? 60000 : 40000,
    slow,
    fast
  };
}

function adaptiveDelay(attempt) {
  const steps = [250, 450, 700, 1100, 1700, 2500, 3600, 5000, 6500];
  return steps[Math.min(attempt, steps.length - 1)];
}

function waitForConnection(maxMs = 20000) {
  if (navigator.onLine !== false) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      window.removeEventListener('online', done);
      resolve();
    };
    window.addEventListener('online', done, { once: true });
    window.setTimeout(done, maxMs);
  });
}

function readExperiencesCache() {
  try {
    const raw = localStorage.getItem(ECIS_EXPERIENCES_CACHE_KEY);
    if (!raw) return [];
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.items)) return [];
    if (Date.now() - Number(cached.savedAt || 0) > ECIS_EXPERIENCES_CACHE_TTL) return [];
    return cached.items;
  } catch (_) {
    return [];
  }
}

function writeExperiencesCache(items) {
  try {
    localStorage.setItem(ECIS_EXPERIENCES_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch (_) {}
}


// =========================================================
// Entrada de datos — evita errores antes de enviar el formulario
// =========================================================

function sanitizePersonName(value) {
  return String(value || '')
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿĀ-ž'’\- ]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/[’']{2,}/g, "'");
}

function sanitizeDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function sanitizeIdentityDocumentInput(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, '')
    .replace(/\s{2,}/g, ' ');
}

function normalizeIdentityDocument(value) {
  return sanitizeIdentityDocumentInput(value).replace(/[^A-Z0-9]/g, '');
}

function sanitizeInternationalPhoneInput(value) {
  const clean = String(value || '').replace(/[^0-9+()\- ]/g, '');
  const firstPlus = clean.startsWith('+') ? '+' : '';
  return firstPlus + clean.replace(/\+/g, '').replace(/\s{2,}/g, ' ');
}

function normalizeInternationalPhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function isValidIdentityDocument(value) {
  return /^[A-Z0-9]{4,25}$/.test(normalizeIdentityDocument(value));
}

function isValidInternationalPhone(value) {
  return /^\d{7,15}$/.test(normalizeInternationalPhone(value));
}

function isValidPersonName(value) {
  const clean = String(value || '').trim();
  return /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:[ '’\-][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*$/.test(clean);
}

function bindSanitizedInput(input, sanitizer, validator, validationMessage) {
  if (!input) return;
  const apply = () => {
    const caret = input.selectionStart;
    const previousLength = input.value.length;
    const sanitized = sanitizer(input.value);
    if (sanitized !== input.value) {
      input.value = sanitized;
      if (typeof caret === 'number') {
        const delta = previousLength - sanitized.length;
        const next = Math.max(0, caret - delta);
        try { input.setSelectionRange(next, next); } catch (_) {}
      }
    }
    input.setCustomValidity(input.value && !validator(input.value) ? validationMessage : '');
  };
  input.addEventListener('input', apply);
  input.addEventListener('blur', apply);
  apply();
}

function initializeInputGuards() {
  const nameMessage = 'Usá letras; podés incluir espacios, apóstrofes y guiones.';
  bindSanitizedInput(document.querySelector('#enroll-name'), sanitizePersonName, value => isValidPersonName(value) && value.trim().length >= 2, nameMessage);
  bindSanitizedInput(document.querySelector('#enroll-last-name'), sanitizePersonName, value => isValidPersonName(value) && value.trim().length >= 2, nameMessage);
  bindSanitizedInput(document.querySelector('#nombre'), sanitizePersonName, value => isValidPersonName(value) && value.trim().length >= 3, nameMessage);
  bindSanitizedInput(document.querySelector('#enroll-document'), sanitizeIdentityDocumentInput, isValidIdentityDocument, 'Ingresá un documento de identidad válido. Puede contener letras y números.');
  bindSanitizedInput(document.querySelector('#enroll-phone'), sanitizeInternationalPhoneInput, isValidInternationalPhone, 'Ingresá un teléfono válido con código de país y de área.');
}


function normalizeEnrollmentData(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    ...data,
    nombre: sanitizePersonName(data.nombre).trim(),
    apellido: sanitizePersonName(data.apellido).trim(),
    documento: normalizeIdentityDocument(data.documento ?? data.dni),
    dni: normalizeIdentityDocument(data.documento ?? data.dni),
    telefono: normalizeInternationalPhone(data.telefono),
    email: String(data.email || '').trim(),
    pais: String(data.pais || 'Argentina').trim() || 'Argentina',
    institucion: String(data.institucion || '').trim()
  };
}

function initializeNetworkStatus() {
  const status = document.createElement('div');
  status.className = 'network-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  document.body.appendChild(status);

  let hideTimer = 0;
  const show = message => {
    window.clearTimeout(hideTimer);
    status.textContent = message;
    status.hidden = false;
    requestAnimationFrame(() => status.classList.add('is-visible'));
  };
  const hide = (delay = 0) => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      status.classList.remove('is-visible');
      window.setTimeout(() => { status.hidden = true; }, 240);
    }, delay);
  };

  window.addEventListener('offline', () => show('Esperando conexión… ECIS conservará este paso y continuará al recuperar señal.'));
  window.addEventListener('online', () => {
    show('Conexión recuperada. Continuamos con tu proceso.');
    hide(1800);
  });
  if (navigator.onLine === false) show('Esperando conexión… ECIS conservará este paso y continuará al recuperar señal.');
}

// =========================================================
// Navegación móvil
// =========================================================

const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');

function closeMobileNav({ focusToggle = false } = {}) {
  nav?.classList.remove('is-open');
  document.body.classList.remove('nav-open');
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Abrir menú');
  if (focusToggle) menuToggle?.focus();
}

menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!open));
  menuToggle.setAttribute('aria-label', open ? 'Abrir menú' : 'Cerrar menú');
  nav?.classList.toggle('is-open', !open);
  document.body.classList.toggle('nav-open', !open);
});

nav?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => closeMobileNav());
});

const currentFile = window.location.pathname.split('/').pop() || 'index.html';
nav?.querySelectorAll('a').forEach(link => {
  if (link.getAttribute('href') === currentFile) link.setAttribute('aria-current', 'page');
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav?.classList.contains('is-open')) {
    closeMobileNav({ focusToggle: true });
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 850 && nav?.classList.contains('is-open')) closeMobileNav();
});

// =========================================================
// Formulario de contacto
// =========================================================

const contactForm = document.querySelector('.contact-form[data-formsubmit-ajax]');
const formStatus = document.querySelector('#form-status');

contactForm?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!contactForm.checkValidity()) {
    contactForm.reportValidity();
    return;
  }

  const submitButton = contactForm.querySelector('button[type="submit"]');
  const originalButtonText = submitButton?.textContent || 'Enviar mensaje →';

  if (formStatus) {
    formStatus.hidden = true;
    formStatus.classList.remove('is-error');
    formStatus.textContent = '';
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Enviando…';
  }

  try {
    const formData = new FormData(contactForm);
    const payload = Object.fromEntries(formData.entries());

    const controller = new AbortController();
    const contactTimeout = window.setTimeout(() => controller.abort(), 8000);
    const response = await fetch(contactForm.dataset.formsubmitAjax, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    window.clearTimeout(contactTimeout);
    let data = {};
    try { data = await response.json(); } catch (_) {}

    if (
      !response.ok ||
      data.success === false ||
      String(data.success).toLowerCase() === 'false'
    ) {
      throw new Error(data.message || 'Podés volver a enviar el mensaje o elegir WhatsApp/correo.');
    }

    contactForm.reset();
    if (formStatus) {
      formStatus.textContent = 'Gracias por comunicarte con ECIS. Recibimos tu consulta y te responderemos a la brevedad.';
      formStatus.hidden = false;
      formStatus.focus({ preventScroll: true });
    }
  } catch (_) {
    if (formStatus) {
      formStatus.textContent = 'Podés volver a enviar el mensaje o elegir correo electrónico o WhatsApp para continuar.';
      formStatus.classList.add('is-error');
      formStatus.hidden = false;
      formStatus.focus({ preventScroll: true });
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
});

// =========================================================
// Aula ECIS — fechas, inscripción y pago simplificado 127
// =========================================================

const enrollmentForm = document.querySelector('#ecis-enrollment-form');
const enrollmentSubmit = document.querySelector('#enrollment-submit');
const experienceSelect = document.querySelector('#enroll-experience');
const experienceSelectorWrap = document.querySelector('#experience-selector-wrap');
const experienceHelp = document.querySelector('#experience-help');
const experienceRetry = document.querySelector('#experience-retry');
const enrollmentError = document.querySelector('#enrollment-error');
const enrollmentStatus = document.querySelector('#enrollment-status');
const editionPicker = document.querySelector('#edition-picker');
const selectedExperienceSummary = document.querySelector('#selected-experience-summary');
const masterclassEditions = document.querySelector('#hm001-editions');
const masterclassDateCount = document.querySelector('#hm001-date-count');
const masterclassPrice = document.querySelector('#hm001-price');
const masterclassEditionsNote = document.querySelector('#hm001-editions-note');

const registrationPostForm = document.querySelector('#ecis-registration-post');
const registrationPostPayload = document.querySelector('#ecis-registration-payload');

let loadedExperiences = [];
let selectedEditionId = '';
let registrationPostPromise = null;
let experiencesWarmupStarted = false;

function warmExperiencesCache(force = false) {
  if (experiencesWarmupStarted && !force) return;
  experiencesWarmupStarted = true;
  const start = () => {
    loadExperiencesJsonp(Math.min(getNetworkProfile().requestTimeout, 6000))
      .then(items => {
        if (Array.isArray(items) && items.length) {
          loadedExperiences = items;
          writeExperiencesCache(items);
        }
      })
      .catch(() => {});
  };
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 1200 });
  else window.setTimeout(start, 180);
}

function consumePrefetchedExperiences() {
  if (!window.__ecisExperiencesPrefetch) return null;
  const data = window.__ecisExperiencesPrefetch;
  if (!Array.isArray(data) || !data.length) return null;
  try {
    writeExperiencesCache(data);
  } catch (_) {}
  return data;
}

async function getPrefetchedExperiences(timeoutMs = 2200) {
  const direct = consumePrefetchedExperiences();
  if (direct) return direct;
  const pending = window.__ecisExperiencesPrefetchPromise;
  if (!pending) return null;
  try {
    const result = await Promise.race([
      pending,
      new Promise(resolve => window.setTimeout(() => resolve(null), timeoutMs))
    ]);
    if (Array.isArray(result) && result.length) {
      writeExperiencesCache(result);
      return result;
    }
  } catch (_) {}
  return null;
}

async function loadExperiencesJsonp(timeoutMs = getNetworkProfile().requestTimeout) {
  const prefetched = await getPrefetchedExperiences(Math.min(timeoutMs, 2200));
  if (prefetched?.length) return prefetched;

  return new Promise((resolve, reject) => {
    const callbackName = `ecisExperiencias_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      script.remove();
    };

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('La respuesta sigue en curso.'));
    }, timeoutMs);

    window[callbackName] = data => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      if (!data || data.resultado !== 'ok' || !Array.isArray(data.experiencias)) {
        reject(new Error(data?.mensaje || 'No pudimos actualizar la disponibilidad.'));
        return;
      }
      resolve(data.experiencias);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('No pudimos actualizar la disponibilidad.'));
    };

    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=experiencias&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

function findExperience(id) {
  return loadedExperiences.find(item => String(item.id) === String(id)) || null;
}

function findEdition(experience, editionId) {
  const edition = (experience?.ediciones || []).find(item => String(item.id) === String(editionId)) || null;
  return edition && edition.disponible !== false ? edition : null;
}

function formatEditionLabel(edition) {
  if (!edition) return '';
  return [edition.fecha, edition.horario].filter(Boolean).join(' · ');
}

function renderMasterclassEditions() {
  if (!masterclassEditions) return;
  const preferredExperienceId = masterclassEditions.dataset.experienceId || 'HM001';
  const experience = findExperience(preferredExperienceId)
    || loadedExperiences.find(item => String(item.tipo || '').trim().toLowerCase() === 'masterclass')
    || loadedExperiences[0]
    || null;
  const experienceId = experience?.id || preferredExperienceId;
  const editions = Array.isArray(experience?.ediciones) ? experience.ediciones : [];
  const available = editions.filter(edition => edition.disponible !== false);

  if (masterclassPrice && experience?.importe) masterclassPrice.textContent = formatArs(experience.importe);
  if (masterclassDateCount) {
    masterclassDateCount.textContent = available.length
      ? `${available.length} ${available.length === 1 ? 'fecha disponible' : 'fechas disponibles'}`
      : 'Próximas fechas a confirmar';
  }

  if (!editions.length) {
    masterclassEditions.innerHTML = '<div class="course-editions-empty"><strong>Próximas fechas a confirmar</strong><span>La inscripción se habilitará cuando publiquemos las nuevas ediciones.</span></div>';
    if (masterclassEditionsNote) masterclassEditionsNote.textContent = 'No habilitamos pagos sin una fecha confirmada.';
    return;
  }

  masterclassEditions.innerHTML = editions.map(edition => {
    const extra = Number.isFinite(Number(edition.lugaresDisponibles)) && Number(edition.lugaresDisponibles) > 0 && Number(edition.lugaresDisponibles) <= 5
      ? ` · ${Number(edition.lugaresDisponibles)} lugares`
      : '';
    if (edition.disponible === false) {
      return `<div class="course-edition-option is-disabled" aria-disabled="true">
        <span><strong>${escapeHtml(edition.fecha)}</strong><small>${escapeHtml(edition.horario || '')}${edition.modalidad ? ` · ${escapeHtml(edition.modalidad)}` : ''}</small></span>
        <b>Completa</b>
      </div>`;
    }
    const quickParams = new URLSearchParams({
      experiencia: String(experienceId || ''),
      edicion: String(edition.id || ''),
      nombre: String(experience?.nombre || ''),
      fecha: String(edition.fecha || ''),
      horario: String(edition.horario || ''),
      modalidad: String(edition.modalidad || 'Virtual'),
      importe: String(experience?.importe || '')
    });
    return `<a class="course-edition-option" href="inscripcion.html?${quickParams.toString()}">
      <span><strong>${escapeHtml(edition.fecha)}</strong><small>${escapeHtml(edition.horario || '')}${edition.modalidad ? ` · ${escapeHtml(edition.modalidad)}` : ''}${escapeHtml(extra)}</small></span>
      <b>Inscribirme →</b>
    </a>`;
  }).join('');

  if (masterclassEditionsNote) masterclassEditionsNote.textContent = available.length
    ? 'Elegí la fecha que mejor se adapte a vos. La inscripción queda vinculada a esa edición.'
    : 'Las fechas publicadas se encuentran completas por el momento.';
}

function renderExperienceSelect(items, preferredId = '') {
  if (!experienceSelect) return;
  experienceSelect.innerHTML = '<option value="">Seleccioná una actividad</option>';
  items.forEach(item => {
    const option = document.createElement('option');
    option.value = String(item.id || '');
    option.textContent = String(item.nombre || '');
    experienceSelect.appendChild(option);
  });
  experienceSelect.disabled = !items.length;
  if (preferredId && items.some(item => String(item.id) === String(preferredId))) {
    experienceSelect.value = String(preferredId);
  }
}

function renderSelectedExperience(experience, edition = null) {
  if (!selectedExperienceSummary) return;
  if (!experience) {
    selectedExperienceSummary.hidden = true;
    selectedExperienceSummary.innerHTML = '';
    return;
  }
  selectedExperienceSummary.innerHTML = `
    <div><span>Actividad</span><strong>${escapeHtml(experience.nombre)}</strong></div>
    ${edition ? `<div><span>Fecha</span><strong>${escapeHtml(formatEditionLabel(edition))}</strong></div>` : ''}
    ${edition ? `<div><span>Modalidad</span><strong>${escapeHtml(edition.modalidad || 'Virtual')}</strong></div>` : ''}
    <div><span>Valor</span><strong>${escapeHtml(formatArs(experience.importe))}</strong></div>
  `;
  selectedExperienceSummary.hidden = false;
}

function renderEditionPicker(experience, preferredEditionId = '') {
  if (!editionPicker) return;
  const editions = Array.isArray(experience?.ediciones) ? experience.ediciones : [];
  const available = editions.filter(edition => edition.disponible !== false);
  selectedEditionId = '';

  if (!experience) {
    editionPicker.innerHTML = '<p class="edition-picker-placeholder">Seleccioná una actividad para ver sus fechas.</p>';
    return;
  }

  if (!editions.length) {
    editionPicker.innerHTML = '<div class="edition-picker-empty"><strong>No hay fechas habilitadas por el momento.</strong><span>ECIS no permite avanzar al pago hasta que exista una fecha confirmada.</span></div>';
    return;
  }

  editionPicker.innerHTML = editions.map((edition, index) => {
    const selectable = edition.disponible !== false;
    const firstAvailableId = available[0]?.id || '';
    const checked = selectable && (String(edition.id) === String(preferredEditionId) || (!preferredEditionId && String(edition.id) === String(firstAvailableId)));
    if (checked) selectedEditionId = String(edition.id);
    return `
      <label class="edition-option${checked ? ' is-selected' : ''}${!selectable ? ' is-disabled' : ''}">
        <input type="radio" name="edicion" value="${escapeHtml(edition.id)}" ${checked ? 'checked' : ''} ${selectable ? '' : 'disabled'}/>
        <span class="edition-date"><strong>${escapeHtml(edition.fecha)}</strong><small>${escapeHtml(edition.horario || '')}</small></span>
        <span class="edition-mode">${selectable ? escapeHtml(edition.modalidad || 'Virtual') : 'Completa'}</span>
      </label>
    `;
  }).join('');

  editionPicker.querySelectorAll('input[name="edicion"]:not(:disabled)').forEach(input => {
    input.addEventListener('change', () => {
      selectedEditionId = String(input.value || '');
      persistEnrollmentDraft();
      editionPicker.querySelectorAll('.edition-option').forEach(label => {
        label.classList.toggle('is-selected', label.querySelector('input')?.checked === true);
      });
    });
  });
}

async function loadAvailability() {
  const cached = readExperiencesCache();
  if (cached.length) loadedExperiences = cached;

  let fresh = null;
  try {
    await waitForConnection();
    fresh = await loadExperiencesJsonp();
    loadedExperiences = fresh;
    writeExperiencesCache(fresh);
  } catch (_) {
    if (!loadedExperiences.length) throw new Error('No pudimos consultar las fechas disponibles. Intentá nuevamente.');
  }
  return loadedExperiences;
}

async function initializeMasterclassDates() {
  if (!masterclassEditions) return;
  const cached = readExperiencesCache();
  if (cached.length) {
    loadedExperiences = cached;
    renderMasterclassEditions();
    if (masterclassEditionsNote) masterclassEditionsNote.textContent = 'Disponibilidad actualizándose…';
  }
  try {
    await waitForConnection();
    const fresh = await loadExperiencesJsonp();
    loadedExperiences = fresh;
    writeExperiencesCache(fresh);
    renderMasterclassEditions();
  } catch (_) {
    if (!loadedExperiences.length) {
      masterclassEditions.innerHTML = '<div class="course-editions-empty"><strong>No pudimos actualizar las fechas.</strong><span>Verificá tu conexión y recargá la página.</span></div>';
      if (masterclassDateCount) masterclassDateCount.textContent = 'Disponibilidad no disponible';
      if (masterclassPrice) masterclassPrice.textContent = 'Consultar';
    } else if (masterclassEditionsNote) {
      masterclassEditionsNote.textContent = 'Mostramos la última disponibilidad guardada. La fecha se valida nuevamente al inscribirte.';
    }
  }
}

function restoreEnrollmentDraft() {
  if (!enrollmentForm) return;
  const draft = readJsonStorage(ECIS_STORAGE_KEY);
  if (!draft) return;
  const mapping = {
    nombre: '#enroll-name', apellido: '#enroll-last-name', email: '#enroll-email',
    documento: '#enroll-document', telefono: '#enroll-phone', pais: '#enroll-country'
  };
  Object.entries(mapping).forEach(([key, selector]) => {
    const input = document.querySelector(selector);
    const value = key === 'documento' ? (draft.documento ?? draft.dni) : draft[key];
    if (input && value != null && !input.value) input.value = value;
  });
  const legal = document.querySelector('#enroll-legal-acceptance');
  if (legal && draft.aceptaLegal) legal.checked = true;
}

function persistEnrollmentDraft() {
  if (!enrollmentForm) return;
  const current = readJsonStorage(ECIS_STORAGE_KEY) || {};
  const experience = findExperience(experienceSelect?.value || current.experienciaId || '');
  const edition = findEdition(experience, selectedEditionId || current.edicionId || '');
  const draft = {
    ...current,
    nombre: document.querySelector('#enroll-name')?.value || '',
    apellido: document.querySelector('#enroll-last-name')?.value || '',
    email: document.querySelector('#enroll-email')?.value || '',
    documento: document.querySelector('#enroll-document')?.value || '',
    telefono: document.querySelector('#enroll-phone')?.value || '',
    pais: document.querySelector('#enroll-country')?.value || 'Argentina',
    aceptaLegal: Boolean(document.querySelector('#enroll-legal-acceptance')?.checked),
    experienciaId: experience?.id || current.experienciaId || '',
    experiencia: experience?.nombre || current.experiencia || '',
    tipo: experience?.tipo || current.tipo || '',
    importe: Number(experience?.importe || current.importe || 0),
    edicionId: edition?.id || current.edicionId || '',
    fecha: edition?.fecha || current.fecha || '',
    horario: edition?.horario || current.horario || '',
    modalidad: edition?.modalidad || current.modalidad || 'Virtual'
  };
  writeJsonStorage(ECIS_STORAGE_KEY, draft);
}

function submitRegistrationThroughIframe(payload) {
  if (!registrationPostForm || !registrationPostPayload) throw new Error('Recargá esta página para continuar.');
  registrationPostForm.action = ECIS_ENDPOINT;
  registrationPostForm.target = 'ecis-registration-frame';
  registrationPostPayload.value = JSON.stringify(payload);
  registrationPostForm.submit();
}

function consultarRegistroJsonp(registroId, timeoutMs = getNetworkProfile().requestTimeout) {
  return new Promise((resolve, reject) => {
    const callbackName = `ecisRegistro_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => {
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      script.remove();
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true; cleanup(); reject(new Error('La conexión sigue en curso.'));
    }, timeoutMs);
    window[callbackName] = data => {
      if (settled) return;
      settled = true; window.clearTimeout(timeout); cleanup(); resolve(data || { resultado: 'pendiente' });
    };
    script.onerror = () => {
      if (settled) return;
      settled = true; window.clearTimeout(timeout); cleanup(); reject(new Error('La respuesta sigue en curso.'));
    };
    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=consultar_registro&registroId=${encodeURIComponent(registroId)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

async function waitForRegistration(registroId, predicate, totalMs = getNetworkProfile().registrationWindow, onProgress = () => {}) {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < totalMs) {
    await waitForConnection();
    onProgress(Date.now() - startedAt);
    try {
      const data = await consultarRegistroJsonp(registroId);
      if (data?.resultado === 'error') throw new Error(data.mensaje || 'ECIS necesita revisar la inscripción.');
      if (data?.resultado === 'ok' && predicate(data)) return data;
    } catch (error) {
      if (error?.message && !/curso|conexión|respuesta/i.test(error.message)) throw error;
    }
    await new Promise(resolve => window.setTimeout(resolve, adaptiveDelay(attempt++)));
  }
  const error = new Error('No recibimos la confirmación a tiempo. Podés tocar “Continuar al pago” otra vez: el reintento usa el mismo identificador y no duplica la inscripción.');
  error.recoverable = true;
  throw error;
}

function postActionAndWait(payload, predicate, onProgress = () => {}) {
  if (registrationPostPromise) return registrationPostPromise;
  registrationPostPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      handler(value);
    };
    const onMessage = event => {
      const allowedOrigins = ['https://script.google.com', 'https://script.googleusercontent.com'];
      if (event.origin && event.origin !== 'null' && !allowedOrigins.some(origin => event.origin === origin || event.origin.endsWith('.googleusercontent.com'))) return;
      const data = event?.data;
      if (!data || data.source !== 'ecis-registration') return;
      const responseRequestId = String(data.solicitudRegistroId || data.registroId || '');
      if (responseRequestId !== String(payload.registroId || '')) return;
      if (data.resultado === 'error') { finish(reject, new Error(data.mensaje || 'No pudimos continuar.')); return; }
      if (data.resultado === 'ok' && predicate(data)) finish(resolve, data);
    };
    window.addEventListener('message', onMessage);
    try { submitRegistrationThroughIframe(payload); }
    catch (error) { finish(reject, error); return; }
    waitForRegistration(payload.registroId, predicate, getNetworkProfile().registrationWindow, onProgress)
      .then(data => finish(resolve, data))
      .catch(error => finish(reject, error));
  }).finally(() => { registrationPostPromise = null; });
  return registrationPostPromise;
}


function getQuickEnrollmentPreview(params) {
  const experienciaId = params.get('experiencia') || '';
  const edicionId = params.get('edicion') || '';
  const nombre = params.get('nombre') || '';
  const fecha = params.get('fecha') || '';
  const horario = params.get('horario') || '';
  const modalidad = params.get('modalidad') || 'Virtual';
  const importe = Number(params.get('importe') || 0);
  if (!experienciaId || !edicionId || !nombre || !fecha || !isValidEcisAmount(importe)) return null;
  return {
    id: experienciaId,
    nombre,
    tipo: 'Masterclass',
    importe,
    ediciones: [{ id: edicionId, fecha, horario, modalidad, disponible: true }]
  };
}

function renderQuickEnrollmentPreview(params) {
  const preview = getQuickEnrollmentPreview(params);
  if (!preview) return null;
  loadedExperiences = [preview];
  selectedEditionId = String(preview.ediciones[0].id);
  renderExperienceSelect(loadedExperiences, preview.id);
  renderSelectedExperience(preview, preview.ediciones[0]);
  if (experienceSelectorWrap) experienceSelectorWrap.hidden = true;
  if (editionPicker) { editionPicker.hidden = true; editionPicker.innerHTML = ''; }
  if (experienceHelp) experienceHelp.hidden = true;
  const title = document.querySelector('#enrollment-choice-title');
  const copy = document.querySelector('#enrollment-choice-copy');
  if (title) title.textContent = 'Tu actividad';
  if (copy) copy.textContent = '';
  return preview;
}

async function initializeEnrollmentPage() {
  if (!enrollmentForm || !experienceSelect) return;
  restoreEnrollmentDraft();
  enrollmentForm.querySelectorAll('input, select').forEach(field => {
    field.addEventListener('input', persistEnrollmentDraft);
    field.addEventListener('change', persistEnrollmentDraft);
  });
  const params = new URLSearchParams(window.location.search);
  const savedDraft = readJsonStorage(ECIS_STORAGE_KEY);
  if (enrollmentSubmit && savedDraft?.registroId && savedDraft?.codigo) enrollmentSubmit.textContent = 'Volver al pago →';
  const requestedExperience = params.get('experiencia') || savedDraft?.experienciaId || '';
  const requestedEdition = params.get('edicion') || savedDraft?.edicionId || '';
  const hasPublishedSelection = Boolean(params.get('experiencia') && params.get('edicion'));
  const quickPreview = renderQuickEnrollmentPreview(params);

  // Si la persona llega desde una edición concreta de Aula ECIS, ocultamos
  // desde el primer instante los controles de selección. Solo se vuelven a
  // mostrar si esa edición no puede validarse.
  if (hasPublishedSelection) {
    if (experienceSelectorWrap) experienceSelectorWrap.hidden = true;
    if (editionPicker) editionPicker.hidden = true;
    if (experienceHelp) experienceHelp.hidden = true;
  }

  try {
    experienceSelect.disabled = true;
    experienceSelect.innerHTML = '<option value="">Cargando actividad…</option>';
    if (quickPreview) {
      try {
        const fresh = await loadExperiencesJsonp(4500);
        if (fresh?.length) {
          loadedExperiences = fresh;
          writeExperiencesCache(fresh);
        }
      } catch (_) {
        loadedExperiences = [quickPreview];
      }
    } else {
      await loadAvailability();
    }
    const preferredExperience = requestedExperience || (loadedExperiences.length === 1 ? String(loadedExperiences[0].id) : '');
    renderExperienceSelect(loadedExperiences, preferredExperience);

    const experience = findExperience(experienceSelect.value || preferredExperience);
    const lockedEdition = findEdition(experience, requestedEdition);
    const lockedFromPublishedDate = Boolean(experience && params.get('experiencia') && params.get('edicion') && lockedEdition);

    if (experience && params.get('experiencia')) {
      experienceSelect.value = String(experience.id);
      if (experienceSelectorWrap) experienceSelectorWrap.hidden = true;
    }

    if (lockedFromPublishedDate) {
      selectedEditionId = String(lockedEdition.id);
      renderSelectedExperience(experience, lockedEdition);
      if (experienceSelectorWrap) experienceSelectorWrap.hidden = true;
      if (editionPicker) {
        editionPicker.hidden = true;
        editionPicker.innerHTML = '';
      }
      if (experienceHelp) {
        experienceHelp.hidden = true;
        experienceHelp.textContent = '';
      }
      const title = document.querySelector('#enrollment-choice-title');
      const copy = document.querySelector('#enrollment-choice-copy');
      if (title) title.textContent = 'Tu actividad seleccionada';
      if (copy) copy.textContent = '';
      persistEnrollmentDraft();
    } else {
      if (experienceSelectorWrap) experienceSelectorWrap.hidden = false;
      renderSelectedExperience(experience);
      renderEditionPicker(experience, requestedEdition);
      if (editionPicker) editionPicker.hidden = false;
      if (experienceHelp) {
        experienceHelp.hidden = false;
        experienceHelp.textContent = experience?.ediciones?.length
          ? 'Elegí una fecha para continuar.'
          : 'Todavía no hay fechas habilitadas para esta actividad.';
      }
      persistEnrollmentDraft();
    }
  } catch (error) {
    setError(enrollmentError, error.message);
    experienceSelect.innerHTML = '<option value="">No disponible</option>';
    experienceSelect.disabled = true;
    if (experienceRetry) experienceRetry.hidden = false;
  }

  experienceSelect.addEventListener('change', () => {
    const experience = findExperience(experienceSelect.value);
    renderSelectedExperience(experience);
    if (editionPicker) editionPicker.hidden = false;
    renderEditionPicker(experience, '');
    persistEnrollmentDraft();
  });

  experienceRetry?.addEventListener('click', () => window.location.reload());

  enrollmentForm.addEventListener('submit', async event => {
    event.preventDefault();
    setError(enrollmentError, '');
    if (enrollmentStatus) { enrollmentStatus.hidden = true; enrollmentStatus.textContent = ''; }
    if (!enrollmentForm.checkValidity()) { enrollmentForm.reportValidity(); return; }

    const experience = findExperience(experienceSelect.value);
    const edition = findEdition(experience, selectedEditionId);
    if (!experience) { setError(enrollmentError, 'Seleccioná una actividad para continuar.'); return; }
    if (!edition) { setError(enrollmentError, 'Seleccioná una fecha para continuar.'); smoothScrollTo(editionPicker, 'start'); return; }
    if (!isValidEcisAmount(experience.importe)) {
      setError(enrollmentError, 'No pudimos obtener correctamente el importe de esta actividad. No se realizó ningún registro. Comunicate con ECIS o intentá nuevamente más tarde.');
      return;
    }

    const data = normalizeEnrollmentData({
      nombre: document.querySelector('#enroll-name')?.value || '',
      apellido: document.querySelector('#enroll-last-name')?.value || '',
      email: document.querySelector('#enroll-email')?.value || '',
      documento: document.querySelector('#enroll-document')?.value || '',
      telefono: document.querySelector('#enroll-phone')?.value || '',
      pais: document.querySelector('#enroll-country')?.value || 'Argentina',
      institucion: '',
      experienciaId: experience.id,
      experiencia: experience.nombre,
      tipo: experience.tipo,
      importe: Number(experience.importe),
      edicionId: edition.id,
      fecha: edition.fecha,
      horario: edition.horario,
      modalidad: edition.modalidad || 'Virtual'
    });

    const existingDraft = normalizeEnrollmentData(readJsonStorage(ECIS_STORAGE_KEY));
    const sameExistingRegistration = Boolean(
      existingDraft?.registroId && existingDraft?.codigo &&
      String(existingDraft.experienciaId || '') === String(data.experienciaId || '') &&
      String(existingDraft.edicionId || '') === String(data.edicionId || '')
    );
    if (sameExistingRegistration) {
      const changed = ['nombre','apellido','email','documento','telefono','pais'].some(key =>
        String(existingDraft[key] || '').trim() !== String(data[key] || '').trim()
      );
      data.registroId = existingDraft.registroId;
      data.codigo = existingDraft.codigo;
      data.estado = existingDraft.estado || 'Pendiente de pago';
      data.mercadoPagoUrl = existingDraft.mercadoPagoUrl || '';
      data.mercadoPagoQr = existingDraft.mercadoPagoQr || '';
      if (!changed) {
        writeJsonStorage(ECIS_STORAGE_KEY, { ...existingDraft, ...data, aceptaLegal: true });
        window.location.href = `pago.html?registro=${encodeURIComponent(existingDraft.registroId)}`;
        return;
      }
      if (enrollmentSubmit) { enrollmentSubmit.disabled = true; enrollmentSubmit.textContent = 'Cargando datos…'; }
      try {
        const updated = await postActionAndWait({
          accion: 'actualizar_inscripcion', registroId: existingDraft.registroId,
          nombre: data.nombre, apellido: data.apellido, documento: data.documento, dni: data.documento, pais: data.pais, email: data.email, telefono: data.telefono
        }, result => Boolean(result.codigo));
        writeJsonStorage(ECIS_STORAGE_KEY, { ...existingDraft, ...data, codigo: updated.codigo || existingDraft.codigo, registroId: updated.registroId || existingDraft.registroId, aceptaLegal: true });
        window.location.href = `pago.html?registro=${encodeURIComponent(updated.registroId || existingDraft.registroId)}`;
      } catch (error) {
        setError(enrollmentError, error?.message || 'No pudimos actualizar tus datos.');
        if (enrollmentSubmit) { enrollmentSubmit.disabled = false; enrollmentSubmit.textContent = 'Continuar →'; }
      }
      return;
    }

    const attemptKey = ECIS_REGISTRATION_ATTEMPT_PREFIX + 'inscripcion';
    const fingerprintKey = attemptKey + '_fingerprint';
    const fingerprint = [data.email.toLowerCase(), data.pais, data.documento, data.experienciaId, data.edicionId].join('|');
    let registroId = '';
    try {
      const savedFingerprint = sessionStorage.getItem(fingerprintKey) || '';
      if (savedFingerprint === fingerprint) registroId = sessionStorage.getItem(attemptKey) || '';
    } catch (_) {}
    if (!registroId) {
      registroId = createRegistrationAttemptId();
      try {
        sessionStorage.setItem(attemptKey, registroId);
        sessionStorage.setItem(fingerprintKey, fingerprint);
      } catch (_) {}
    }

    const originalText = enrollmentSubmit?.textContent || 'Continuar al pago →';
    if (navigator.onLine === false) {
      setError(enrollmentError, 'No hay conexión a internet. Cuando vuelva la conexión, tocá “Continuar al pago” nuevamente.');
      return;
    }
    if (enrollmentSubmit) { enrollmentSubmit.disabled = true; enrollmentSubmit.textContent = 'Cargando datos…'; }

    try {
      const response = await postActionAndWait({
        accion: 'crear_inscripcion', registroId,
        nombre: data.nombre, apellido: data.apellido, documento: data.documento, dni: data.documento, pais: data.pais, email: data.email,
        telefono: data.telefono, institucion: '', experienciaId: data.experienciaId, edicionId: data.edicionId,
        aceptaLegal: document.querySelector('#enroll-legal-acceptance')?.checked ? 'si' : '',
        versionCondiciones: '2026-11-05-v5', versionPrivacidad: '2026-11-05-v3'
      }, result => Boolean(result.codigo), elapsed => {
        if (!enrollmentSubmit) return;
        if (navigator.onLine === false) enrollmentSubmit.textContent = 'Esperando conexión…';
        else if (elapsed > 5500) enrollmentSubmit.textContent = 'Cargando datos…';
      });

      const canonicalRegistroId = String(response.registroId || registroId).trim();
      data.registroId = canonicalRegistroId;
      data.codigo = String(response.codigo || '').trim();
      data.estado = String(response.estado || 'Pendiente de pago');
      data.emailEnviado = response.emailEnviado !== false;
      data.mercadoPagoUrl = String(response.mercadoPagoUrl || experience.mercadoPagoUrl || '').trim();
      data.mercadoPagoQr = String(response.mercadoPagoQr || experience.mercadoPagoQr || '').trim();
      data.aceptaLegal = true;
      writeJsonStorage(ECIS_STORAGE_KEY, data);
      writeJsonStorage(ECIS_RESULT_KEY, { codigo: data.codigo, registroId: canonicalRegistroId, experienciaId: data.experienciaId, edicionId: data.edicionId, email: data.email, emailEnviado: data.emailEnviado });
      try {
        sessionStorage.removeItem(ECIS_REGISTRATION_ATTEMPT_PREFIX + 'inscripcion');
        sessionStorage.removeItem(ECIS_REGISTRATION_ATTEMPT_PREFIX + 'inscripcion_fingerprint');
      } catch (_) {}

      if (data.estado === 'Confirmada') {
        if (enrollmentStatus) {
          enrollmentStatus.textContent = `Ya existe una inscripción confirmada para esta fecha (${data.codigo}). Te reenviamos la información al correo registrado.`;
          enrollmentStatus.hidden = false;
          smoothScrollTo(enrollmentStatus, 'center');
        }
        if (enrollmentSubmit) { enrollmentSubmit.disabled = true; enrollmentSubmit.textContent = 'Inscripción ya confirmada'; }
        return;
      }
      if (data.estado === 'Comprobante recibido' || data.estado === 'Observada') {
        if (enrollmentStatus) {
          enrollmentStatus.textContent = data.estado === 'Comprobante recibido'
            ? `Ya tenemos una inscripción para esta fecha y el comprobante está en revisión (${data.codigo}). Te reenviamos la información al correo registrado.`
            : `Ya existe una inscripción para esta fecha que requiere revisión administrativa (${data.codigo}). Te reenviamos la información al correo registrado.`;
          enrollmentStatus.hidden = false;
          smoothScrollTo(enrollmentStatus, 'center');
        }
        if (enrollmentSubmit) { enrollmentSubmit.disabled = true; enrollmentSubmit.textContent = 'Inscripción encontrada'; }
        return;
      }
      window.location.href = `pago.html?registro=${encodeURIComponent(canonicalRegistroId)}`;
    } catch (error) {
      setError(enrollmentError, error?.message || 'No pudimos generar tu inscripción. Volvé a intentarlo.');
      if (enrollmentSubmit) { enrollmentSubmit.disabled = false; enrollmentSubmit.textContent = originalText; }
    }
  });
}

// =========================================================
// Pago — pago.html
// =========================================================

const paymentLoading = document.querySelector('#payment-loading');
const paymentFlow = document.querySelector('#payment-flow');
const paymentLoadError = document.querySelector('#payment-load-error');
const paymentStatusCard = document.querySelector('#payment-status-card');
const paymentStatusTitle = document.querySelector('#payment-status-title');
const paymentStatusText = document.querySelector('#payment-status-text');
const paymentSummary = document.querySelector('#payment-summary');
const paymentAmount = document.querySelector('#payment-amount');
const transferAmount = document.querySelector('#transfer-amount');
const paymentMethodCard = document.querySelector('#payment-method-card');
const transferCheckout = document.querySelector('#transfer-checkout');
const mpCheckout = document.querySelector('#mp-checkout');
const mpProofCheckout = document.querySelector('#mp-proof-checkout');
const chooseTransfer = document.querySelector('#choose-transfer');
const chooseMp = document.querySelector('#choose-mp');
const copyTransferAlias = document.querySelector('#copy-transfer-alias');
const mpCheckoutAmount = document.querySelector('#mp-checkout-amount');
const mpCheckoutCode = document.querySelector('#mp-checkout-code');
const mpRedirectButton = document.querySelector('#mp-redirect-button');
const mpQrImage = document.querySelector('#mp-qr-image');
const mpQrContainer = document.querySelector('#mp-qr-container');
const mpQrContinue = document.querySelector('#mp-qr-continue');
const paymentBackButtons = Array.from(document.querySelectorAll('[data-payment-back]'));
const paymentRegistrationCode = document.querySelector('#payment-registration-code');
const copyPaymentCode = document.querySelector('#copy-payment-code');
const paymentCodeHelp = document.querySelector('#payment-code-help');
const paymentEdit = document.querySelector('#payment-edit');
const transferWhatsappProof = document.querySelector('#transfer-whatsapp-proof');
const transferEmailProof = document.querySelector('#transfer-email-proof');
const mpWhatsappProof = document.querySelector('#mp-whatsapp-proof');
const mpEmailProof = document.querySelector('#mp-email-proof');
const progressPayment = document.querySelector('#progress-payment');
const progressProof = document.querySelector('#progress-proof');

let paymentDraft = null;

function renderPaymentSummary(data) {
  if (!paymentSummary) return;
  const dateLine = [data.fecha, data.horario].filter(Boolean).join(' · ');
  const rows = [
    ['Actividad', data.experiencia],
    ['Fecha', dateLine || '—'],
    ['Modalidad', data.modalidad || 'Virtual'],
    ['Importe', formatArs(data.importe)]
  ];
  paymentSummary.innerHTML = rows.map(([label, value]) => `
    <div class="checkout-summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join('');
}

function getProofLinks(code, data, methodLabel) {
  const dateLine = [data.fecha, data.horario].filter(Boolean).join(' · ');
  const whatsappText = [
    'Hola ECIS. Envío mi comprobante de pago para completar la inscripción.', '',
    `N.º de inscripción: ${code}`,
    `Nombre y apellido: ${getEnrollmentFullName(data)}`,
    `Actividad: ${data.experiencia}`,
    `Fecha: ${dateLine}`,
    `Medio de pago: ${methodLabel}`,
    `Importe: ${formatArs(data.importe)}`, '',
    'Adjunto el comprobante de pago.'
  ].join('\n');
  const emailSubject = `Comprobante de pago — ${code}`;
  const emailBody = [
    'Hola ECIS:', '', 'Envío mi comprobante de pago para completar la inscripción.', '',
    `N.º de inscripción: ${code}`,
    `Nombre y apellido: ${getEnrollmentFullName(data)}`,
    `Actividad: ${data.experiencia}`,
    `Fecha: ${dateLine}`,
    `Medio de pago: ${methodLabel}`,
    `Importe: ${formatArs(data.importe)}`, '', 'Adjunto el comprobante de pago.'
  ].join('\n');
  return {
    whatsapp: `https://wa.me/${ECIS_WHATSAPP}?text=${encodeURIComponent(whatsappText)}`,
    email: `mailto:${ECIS_EMAIL}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
  };
}

function configureProofLinks(methodKey, methodLabel, whatsappLink, emailLink) {
  if (!paymentDraft || !whatsappLink || !emailLink) return;
  const links = getProofLinks(paymentDraft.codigo, paymentDraft, methodLabel);
  whatsappLink.href = links.whatsapp;
  emailLink.href = links.email;
  const mark = () => {
    try {
      submitRegistrationThroughIframe({ accion: 'marcar_pago', registroId: paymentDraft.registroId, medioPago: methodKey });
      updatePaymentProgress(true);
      const card = whatsappLink.closest('.checkout-card');
      const finish = card?.querySelector('[data-proof-finish]');
      if (finish) finish.hidden = false;
    } catch (_) {}
  };
  whatsappLink.onclick = mark;
  emailLink.onclick = mark;
}

function updatePaymentProgress(proof = false) {
  progressPayment?.classList.toggle('is-current', !proof);
  progressPayment?.classList.toggle('is-complete', proof);
  progressProof?.classList.toggle('is-current', proof);
}

function showPaymentChoice() {
  if (paymentMethodCard) paymentMethodCard.hidden = false;
  if (transferCheckout) transferCheckout.hidden = true;
  if (mpCheckout) mpCheckout.hidden = true;
  if (mpProofCheckout) mpProofCheckout.hidden = true;
  writeJsonStorage(ECIS_PAYMENT_STAGE_KEY, { registroId: paymentDraft?.registroId || '', stage: 'choice' });
  updatePaymentProgress(false);
  smoothScrollTo(paymentMethodCard, 'start');
}

function showTransferStep() {
  if (paymentMethodCard) paymentMethodCard.hidden = true;
  if (transferCheckout) transferCheckout.hidden = false;
  if (mpCheckout) mpCheckout.hidden = true;
  if (mpProofCheckout) mpProofCheckout.hidden = true;
  writeJsonStorage(ECIS_PAYMENT_STAGE_KEY, { registroId: paymentDraft?.registroId || '', stage: 'transfer' });
  configureProofLinks('Transferencia', 'Transferencia', transferWhatsappProof, transferEmailProof);
  smoothScrollTo(transferCheckout, 'start');
}

function showMpStep() {
  const config = getMpLinkConfig(paymentDraft);
  if (!config) { setError(paymentLoadError, 'Mercado Pago no está disponible para esta actividad. Podés utilizar transferencia.'); return; }
  if (mpRedirectButton) mpRedirectButton.href = config.url;
  if (mpQrContainer) mpQrContainer.hidden = !config.qr;
  if (mpQrImage && config.qr) mpQrImage.src = config.qr;
  if (paymentMethodCard) paymentMethodCard.hidden = true;
  if (transferCheckout) transferCheckout.hidden = true;
  if (mpProofCheckout) mpProofCheckout.hidden = true;
  if (mpCheckout) mpCheckout.hidden = false;
  writeJsonStorage(ECIS_PAYMENT_STAGE_KEY, { registroId: paymentDraft?.registroId || '', stage: 'mp' });
  smoothScrollTo(mpCheckout, 'start');
}

function showMpProofStep({ persist = true } = {}) {
  if (!paymentDraft) return;
  if (paymentMethodCard) paymentMethodCard.hidden = true;
  if (transferCheckout) transferCheckout.hidden = true;
  if (mpCheckout) mpCheckout.hidden = true;
  if (mpProofCheckout) mpProofCheckout.hidden = false;
  configureProofLinks('MercadoPagoLink', 'Mercado Pago', mpWhatsappProof, mpEmailProof);
  updatePaymentProgress(true);
  if (persist) {
    writeJsonStorage(ECIS_PAYMENT_STAGE_KEY, {
      registroId: paymentDraft.registroId,
      stage: 'mp-proof'
    });
  }
  smoothScrollTo(mpProofCheckout, 'start');
}

async function recoverPaymentDraft(registroId) {
  const stored = normalizeEnrollmentData(readJsonStorage(ECIS_STORAGE_KEY));
  try {
    const server = await consultarRegistroJsonp(registroId, getNetworkProfile().requestTimeout);
    if (!server || server.resultado !== 'ok' || !server.codigo) throw new Error(server?.mensaje || 'No pudimos recuperar esta inscripción.');
    if (!isValidEcisAmount(server.importe)) throw new Error('El importe de esta inscripción no es válido. ECIS debe corregirlo antes de continuar con el pago.');
    const data = normalizeEnrollmentData({
      registroId: server.registroId || registroId,
      codigo: server.codigo,
      estado: server.estado || 'Pendiente de pago',
      nombre: server.nombre || '',
      apellido: server.apellido || '',
      email: server.email || '',
      documento: server.documento || server.dni || '', dni: server.documento || server.dni || '', pais: server.pais || 'Argentina', telefono: server.telefono || '', institucion: '',
      experienciaId: server.experienciaId,
      experiencia: server.experiencia,
      tipo: server.tipo || '',
      importe: Number(server.importe || 0),
      edicionId: server.edicionId,
      fecha: server.fecha,
      horario: server.horario,
      modalidad: server.modalidad || 'Virtual',
      medioPago: server.medioPago || '',
      medioPagoClave: server.medioPagoClave || '',
      comprobante: server.comprobante || '',
      mercadoPagoUrl: server.mercadoPagoUrl || '',
      mercadoPagoQr: server.mercadoPagoQr || '',
      emailEnviado: server.emailEnviado !== false
    });
    writeJsonStorage(ECIS_STORAGE_KEY, data);
    return data;
  } catch (error) {
    if (stored?.registroId === registroId && stored?.codigo && isValidEcisAmount(stored?.importe)) return stored;
    throw error;
  }
}

function finalizeEnrollmentInBackground(registroId) {
  if (!registroId) return;
  const key = `ecis_finalized_${registroId}`;
  try { if (sessionStorage.getItem(key) === '1') return; } catch (_) {}
  window.setTimeout(() => {
    try {
      submitRegistrationThroughIframe({ accion: 'finalizar_inscripcion', registroId });
      try { sessionStorage.setItem(key, '1'); } catch (_) {}
    } catch (_) {}
  }, 250);
}

async function initializePaymentPage() {
  if (!paymentLoading) return;
  const params = new URLSearchParams(window.location.search);
  const stored = readJsonStorage(ECIS_STORAGE_KEY);
  const registroId = params.get('registro') || stored?.registroId || '';
  if (!registroId) {
    window.location.replace('inscripcion.html');
    return;
  }

  try {
    const storedDraft = normalizeEnrollmentData(readJsonStorage(ECIS_STORAGE_KEY));
    if (storedDraft?.registroId === registroId && storedDraft?.codigo && storedDraft?.experienciaId && storedDraft?.edicionId && isValidEcisAmount(storedDraft?.importe)) {
      paymentDraft = storedDraft;
      renderPaymentSummary(paymentDraft);
      if (paymentRegistrationCode) paymentRegistrationCode.textContent = paymentDraft.codigo;
      if (mpCheckoutCode) mpCheckoutCode.textContent = paymentDraft.codigo;
      if (paymentAmount) paymentAmount.textContent = formatArs(paymentDraft.importe);
      if (transferAmount) transferAmount.textContent = formatArs(paymentDraft.importe);
      if (mpCheckoutAmount) mpCheckoutAmount.textContent = formatArs(paymentDraft.importe);
      paymentLoading.hidden = true;
      paymentFlow.hidden = false;
      finalizeEnrollmentInBackground(registroId);
    }
    paymentDraft = await recoverPaymentDraft(registroId);
    if (!paymentDraft?.codigo || !paymentDraft?.experienciaId || !paymentDraft?.edicionId) throw new Error('Faltan datos para continuar con esta inscripción.');
    if (!isValidEcisAmount(paymentDraft.importe)) throw new Error('El importe de esta inscripción no es válido. ECIS debe corregirlo antes de continuar con el pago.');

    if (['Confirmada', 'Comprobante recibido', 'Observada'].includes(paymentDraft.estado)) {
      paymentLoading.hidden = true;
      if (paymentStatusCard) paymentStatusCard.hidden = false;
      if (paymentStatusTitle) paymentStatusTitle.textContent = paymentDraft.estado === 'Confirmada' ? 'Tu inscripción ya está confirmada' : (paymentDraft.estado === 'Comprobante recibido' ? 'Tu comprobante está en revisión' : 'Tu inscripción está siendo revisada');
      if (paymentStatusText) paymentStatusText.textContent = paymentDraft.estado === 'Confirmada'
        ? `No necesitás realizar otro pago. Tu N.º de inscripción es ${paymentDraft.codigo}.`
        : (paymentDraft.estado === 'Comprobante recibido'
          ? `Ya registramos la recepción del comprobante para ${paymentDraft.codigo}. No necesitás volver a enviarlo salvo que ECIS te lo solicite.`
          : `La inscripción ${paymentDraft.codigo} requiere una revisión administrativa. Si necesitás asistencia, podés comunicarte con ECIS.`);
      return;
    }

    renderPaymentSummary(paymentDraft);
    if (paymentRegistrationCode) paymentRegistrationCode.textContent = paymentDraft.codigo;
    if (mpCheckoutCode) mpCheckoutCode.textContent = paymentDraft.codigo;
    if (paymentAmount) paymentAmount.textContent = formatArs(paymentDraft.importe);
    if (paymentEdit) paymentEdit.href = `inscripcion.html?experiencia=${encodeURIComponent(paymentDraft.experienciaId)}&edicion=${encodeURIComponent(paymentDraft.edicionId)}&registro=${encodeURIComponent(paymentDraft.registroId)}`;
    if (transferAmount) transferAmount.textContent = formatArs(paymentDraft.importe);
    if (mpCheckoutAmount) mpCheckoutAmount.textContent = formatArs(paymentDraft.importe);
    if (paymentCodeHelp && paymentDraft.emailEnviado === false) {
      paymentCodeHelp.textContent = 'Guardá este número de inscripción. No pudimos confirmar el envío por correo, pero tu inscripción ya fue iniciada.';
    }
    const config = getMpLinkConfig(paymentDraft);
    if (chooseMp && !config) {
      chooseMp.disabled = true;
      chooseMp.classList.add('is-disabled');
      const small = chooseMp.querySelector('small');
      if (small) small.textContent = 'No disponible para esta actividad';
    }
    paymentLoading.hidden = true;
    paymentFlow.hidden = false;

    finalizeEnrollmentInBackground(registroId);
    const savedPaymentStage = readJsonStorage(ECIS_PAYMENT_STAGE_KEY);
    if (savedPaymentStage?.registroId === paymentDraft.registroId) {
      if (savedPaymentStage.stage === 'transfer') window.setTimeout(showTransferStep, 0);
      else if (savedPaymentStage.stage === 'mp') window.setTimeout(showMpStep, 0);
      else if (savedPaymentStage.stage === 'mp-proof') window.setTimeout(() => showMpProofStep({ persist: false }), 0);
    }
  } catch (error) {
    paymentLoading.hidden = true;
    setError(paymentLoadError, `${error.message} Volvé a iniciar la inscripción o escribinos si necesitás ayuda.`);
  }
}

chooseTransfer?.addEventListener('click', showTransferStep);
chooseMp?.addEventListener('click', () => { if (!chooseMp.disabled) showMpStep(); });
mpRedirectButton?.addEventListener('click', () => {
  window.setTimeout(() => showMpProofStep(), 120);
});
mpQrContinue?.addEventListener('click', () => showMpProofStep());
paymentBackButtons.forEach(button => button.addEventListener('click', showPaymentChoice));

copyTransferAlias?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('lucas.eci');
    const original = copyTransferAlias.textContent;
    copyTransferAlias.textContent = 'Copiado';
    window.setTimeout(() => { copyTransferAlias.textContent = original; }, 1600);
  } catch (_) { window.prompt('Copiá el alias:', 'lucas.eci'); }
});

async function copyCodeFrom(element, button) {
  const code = element?.textContent?.trim();
  if (!code || !button) return;
  try {
    await navigator.clipboard.writeText(code);
    const original = button.textContent;
    button.textContent = 'Número copiado';
    window.setTimeout(() => { button.textContent = original; }, 1600);
  } catch (_) { window.prompt('Copiá tu número de inscripción:', code); }
}
copyPaymentCode?.addEventListener('click', () => copyCodeFrom(paymentRegistrationCode, copyPaymentCode));

warmExperiencesCache();
initializeMasterclassDates();
initializeEnrollmentPage();


// =========================================================
// ECIS 116 — movimiento sutil y navegación
// =========================================================
function initializeArtDirection109() {
  document.body.classList.add('is-ready');

  const header = document.querySelector('#site-header') || document.querySelector('.site-header');
  const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 26);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  const current = (location.pathname.split('/').pop() || 'index.html').split('?')[0];
  document.querySelectorAll('.main-nav a[href]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href === current) link.setAttribute('aria-current','page');
  });

  if (prefersReducedMotion() || isLowPowerDevice()) {
    document.querySelectorAll('.reveal,.lux-reveal').forEach(el => el.classList.add('is-revealed'));
    return;
  }

  const targets = Array.from(document.querySelectorAll('.reveal,.value-item,.source-reference-card,.checkout-card,.contact-row,.experience-card,.profile-editorial,.admin-band,.philosophy-grid,.institution-band-grid,.masterclass-course-card,.formats-heading,.home-experience-inner,.page-banner-content,.contact-form-wrap'));
  targets.forEach((element,index) => {
    element.classList.add('lux-reveal');
    element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 70}ms`);
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -3% 0px' });
    targets.forEach(el => observer.observe(el));
  } else targets.forEach(el => el.classList.add('is-revealed'));


}

function initializePremiumMicroInteractions() {
  if (prefersReducedMotion() || isLowPowerDevice()) return;
  const finePointer = window.matchMedia?.('(hover:hover) and (pointer:fine)').matches;
  if (!finePointer) return;

  const cards = document.querySelectorAll('.experience-card-link,.masterclass-course-card:not(.masterclass-course-card-upcoming),.source-reference-card,.checkout-card,.contact-form-wrap');
  cards.forEach(card => {
    if (card.querySelector(':scope > .ecis-card-glow')) return;
    const glow = document.createElement('span');
    glow.className = 'ecis-card-glow';
    glow.setAttribute('aria-hidden', 'true');
    card.appendChild(glow);
    card.addEventListener('pointermove', event => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--pointer-x', `${event.clientX - rect.left}px`);
      card.style.setProperty('--pointer-y', `${event.clientY - rect.top}px`);
    });
  });
}

initializeInputGuards();
initializeNetworkStatus();
initializeArtDirection109();
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => initializePremiumMicroInteractions(), { timeout: 1600 });
} else {
  window.setTimeout(() => initializePremiumMicroInteractions(), 900);
}
initializePaymentPage();

window.addEventListener('pageshow', event => {
  if (!enrollmentForm) return;
  restoreEnrollmentDraft();
  const draft = readJsonStorage(ECIS_STORAGE_KEY);
  if (draft?.edicionId) selectedEditionId = String(draft.edicionId);
  if (enrollmentSubmit) {
    enrollmentSubmit.disabled = false;
    enrollmentSubmit.textContent = draft?.registroId && draft?.codigo ? 'Volver al pago →' : 'Continuar →';
  }
});
