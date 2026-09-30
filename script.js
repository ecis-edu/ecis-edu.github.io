// =========================================================
// ECIS — clásica mejorada 117
// Base visual/textual pre-106 + movimiento sutil, acciones claras y tolerancia de red adaptativa
// =========================================================

const ECIS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwm5voUlP5k02F-bNalKUkUknY2SvKe6PVpgOivqn8z0zKPKHNzGmII0UNxJLfljTkp/exec';
const ECIS_STORAGE_KEY = 'ecis_enrollment_draft';
const ECIS_RESULT_KEY = 'ecis_enrollment_result';
const ECIS_REGISTRATION_ATTEMPT_PREFIX = 'ecis_registration_attempt_';
const ECIS_PAYMENT_STAGE_KEY = 'ecis_payment_stage';
const ECIS_EXPERIENCES_CACHE_KEY = 'ecis_experiences_cache_v1';
const ECIS_EXPERIENCES_CACHE_TTL = 30 * 60 * 1000;
const ECIS_WHATSAPP = '5401136741338';
const ECIS_EMAIL = 'ecis.ar.edu@gmail.com';

// Cada link de Mercado Pago está asociado de forma explícita a una experiencia
// y a su importe. Si el importe de la hoja cambia, Mercado Pago se deshabilita
// para evitar cobrar un monto incorrecto mediante un link fijo.
const ECIS_MP_LINKS = {
  HM001: {
    url: 'https://mpago.la/2QWYbxw',
    qr: 'assets/images/mercadopago-link-qr.png',
    amount: 15000
  }
};

// =========================================================
// Utilidades generales
// =========================================================

document.querySelectorAll('#year').forEach(el => {
  el.textContent = new Date().getFullYear();
});

function readJsonStorage(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function removeStorage(key) {
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

function formatArs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `ARS $${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(number)}`;
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
  const id = String(data?.experienciaId || '');
  const config = ECIS_MP_LINKS[id];
  if (!config) return null;

  const amount = Number(data?.importe);
  if (!Number.isFinite(amount) || amount !== Number(config.amount)) return null;
  return config;
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
    requestTimeout: slow ? 32000 : (fast ? 8000 : 16000),
    registrationWindow: slow ? 10 * 60 * 1000 : 7 * 60 * 1000,
    slow,
    fast
  };
}

function adaptiveDelay(attempt) {
  const steps = [250, 450, 700, 1100, 1700, 2500, 3600, 5000, 6500];
  return steps[Math.min(attempt, steps.length - 1)];
}

function waitForConnection(maxMs = 120000) {
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
  bindSanitizedInput(document.querySelector('#enroll-dni'), sanitizeDigits, value => /^\d{6,12}$/.test(value), 'Escribí el DNI únicamente con números.');
  bindSanitizedInput(document.querySelector('#enroll-phone'), sanitizeDigits, value => /^\d{8,15}$/.test(value), 'Escribí el teléfono únicamente con números e incluí el código de área.');
}


function normalizeEnrollmentData(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    ...data,
    nombre: sanitizePersonName(data.nombre).trim(),
    apellido: sanitizePersonName(data.apellido).trim(),
    dni: sanitizeDigits(data.dni),
    telefono: sanitizeDigits(data.telefono),
    email: String(data.email || '').trim(),
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

    const response = await fetch(contactForm.dataset.formsubmitAjax, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let data = {};
    try { data = await response.json(); } catch (_) {}

    if (!response.ok || data.success === false) {
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
// Inscripción — inscripcion.html
// =========================================================

const enrollmentForm = document.querySelector('#ecis-enrollment-form');
const experienceSelect = document.querySelector('#enroll-experience');
const experienceHelp = document.querySelector('#experience-help');
const experienceRetry = document.querySelector('#experience-retry');
const enrollmentError = document.querySelector('#enrollment-error');

let loadedExperiences = [];

function loadExperiencesJsonp(timeoutMs = getNetworkProfile().requestTimeout) {
  if (!experienceSelect) return Promise.resolve([]);

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
        reject(new Error(data?.mensaje || 'Actualizá la información de experiencias para continuar.'));
        return;
      }
      resolve(data.experiencias);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('La respuesta sigue en curso.'));
    };

    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=experiencias&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

function renderExperiences(items, { preserveSelection = true } = {}) {
  if (!experienceSelect) return;
  const current = preserveSelection ? experienceSelect.value : '';
  loadedExperiences = Array.isArray(items) ? items : [];
  experienceSelect.innerHTML = '<option value="">Seleccioná una experiencia</option>';

  loadedExperiences.forEach(item => {
    const option = document.createElement('option');
    option.value = String(item.id || '');
    option.textContent = String(item.nombre || '');
    option.dataset.name = String(item.nombre || '');
    option.dataset.type = String(item.tipo || '');
    option.dataset.amount = String(item.importe ?? '');
    experienceSelect.appendChild(option);
  });

  experienceSelect.disabled = !loadedExperiences.length;
  if (current && loadedExperiences.some(item => String(item.id) === String(current))) {
    experienceSelect.value = current;
  }
}

function applyPreferredExperience() {
  if (!experienceSelect || !loadedExperiences.length) return;
  const draft = readJsonStorage(ECIS_STORAGE_KEY);
  const requestedId = new URLSearchParams(window.location.search).get('experiencia');
  const preferredId = requestedId || draft?.experienciaId || '';
  if (preferredId && loadedExperiences.some(item => String(item.id) === String(preferredId))) {
    experienceSelect.value = String(preferredId);
  }
}

function guideToEnrollmentIfRequested() {
  const requestedId = new URLSearchParams(window.location.search).get('experiencia');
  if (!requestedId) return;
  window.setTimeout(() => {
    const card = document.querySelector('#inscripcion-form');
    smoothScrollTo(card, 'start');
    const firstEmpty = Array.from(enrollmentForm?.querySelectorAll('input[required],select[required]') || [])
      .find(field => !String(field.value || '').trim());
    firstEmpty?.focus({ preventScroll: true });
  }, 180);
}

async function populateExperiences() {
  if (!experienceSelect) return;

  const cached = readExperiencesCache();
  if (cached.length) {
    renderExperiences(cached, { preserveSelection: false });
    applyPreferredExperience();
    if (experienceHelp) experienceHelp.textContent = 'Experiencia lista. El importe se mostrará en el siguiente paso.';
  } else {
    experienceSelect.disabled = true;
    experienceSelect.innerHTML = '<option value="">Cargando experiencias…</option>';
  }

  if (experienceRetry) experienceRetry.hidden = true;
  setError(enrollmentError, '');

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await waitForConnection();
      const fresh = await loadExperiencesJsonp();
      renderExperiences(fresh);
      writeExperiencesCache(fresh);
      applyPreferredExperience();
      if (experienceHelp) {
        experienceHelp.textContent = fresh.length
          ? 'Experiencia lista. El importe se mostrará en el siguiente paso.'
          : 'Las próximas experiencias se publicarán acá.';
      }
      guideToEnrollmentIfRequested();
      return;
    } catch (error) {
      lastError = error;
      if (cached.length) {
        guideToEnrollmentIfRequested();
        return;
      }
      await new Promise(resolve => window.setTimeout(resolve, adaptiveDelay(attempt)));
    }
  }

  experienceSelect.innerHTML = '<option value="">Actualizá las experiencias</option>';
  experienceSelect.disabled = true;
  if (experienceHelp) experienceHelp.textContent = 'La conexión está tardando. Tocá “Actualizar experiencias” para continuar.';
  if (experienceRetry) experienceRetry.hidden = false;
  setError(enrollmentError, '');
}


function restoreEnrollmentDraft() {
  if (!enrollmentForm) return;
  const draft = readJsonStorage(ECIS_STORAGE_KEY);
  if (!draft) return;

  const mapping = {
    nombre: '#enroll-name',
    apellido: '#enroll-last-name',
    email: '#enroll-email',
    dni: '#enroll-dni',
    telefono: '#enroll-phone',
    institucion: '#enroll-institution'
  };

  Object.entries(mapping).forEach(([key, selector]) => {
    const input = document.querySelector(selector);
    if (input && draft[key] != null) input.value = draft[key];
  });
}

if (enrollmentForm) {
  restoreEnrollmentDraft();
  populateExperiences();
  experienceRetry?.addEventListener('click', populateExperiences);
  window.addEventListener('online', () => { if (experienceSelect?.disabled) populateExperiences(); });

  enrollmentForm.addEventListener('submit', event => {
    event.preventDefault();
    setError(enrollmentError, '');

    if (!enrollmentForm.checkValidity()) {
      enrollmentForm.reportValidity();
      return;
    }

    const selected = experienceSelect?.selectedOptions?.[0];
    if (!selected?.value) {
      setError(enrollmentError, 'Seleccioná una experiencia para continuar.');
      experienceSelect?.focus();
      return;
    }

    const data = {
      nombre: String(document.querySelector('#enroll-name')?.value || '').trim(),
      apellido: String(document.querySelector('#enroll-last-name')?.value || '').trim(),
      email: String(document.querySelector('#enroll-email')?.value || '').trim(),
      dni: String(document.querySelector('#enroll-dni')?.value || '').trim(),
      telefono: String(document.querySelector('#enroll-phone')?.value || '').trim(),
      institucion: String(document.querySelector('#enroll-institution')?.value || '').trim(),
      experienciaId: selected.value,
      experiencia: selected.dataset.name || selected.textContent || '',
      tipo: selected.dataset.type || '',
      importe: Number(selected.dataset.amount || 0)
    };

    if (!data.experiencia || !Number.isFinite(data.importe) || data.importe <= 0) {
      setError(enrollmentError, 'Actualizá las experiencias para continuar con los datos correctos.');
      return;
    }

    // Cada envío del formulario inicia una inscripción nueva y limpia.
    removeStorage(ECIS_RESULT_KEY);
    clearRegistrationAttempts();
    removeStorage(ECIS_PAYMENT_STAGE_KEY);
    writeJsonStorage(ECIS_STORAGE_KEY, data);
    window.location.href = 'pago.html';
  });
}

// =========================================================
// Pago — pago.html
// =========================================================

const paymentSummary = document.querySelector('#payment-summary');
const paymentAmount = document.querySelector('#payment-amount');
const transferAmount = document.querySelector('#transfer-amount');
const paymentProceed = document.querySelector('#payment-proceed');
const paymentMethodCard = document.querySelector('#payment-method-card');
const transferCheckout = document.querySelector('#transfer-checkout');
const paymentError = document.querySelector('#payment-error');
const transferDone = document.querySelector('#transfer-done');
const copyTransferAlias = document.querySelector('#copy-transfer-alias');
const paymentFlow = document.querySelector('#payment-flow');
const finishedPanel = document.querySelector('#registration-finished');
const finalRegistrationCode = document.querySelector('#final-registration-code');
const copyRegistrationCode = document.querySelector('#copy-registration-code');
const whatsappProof = document.querySelector('#send-whatsapp-proof');
const emailProof = document.querySelector('#send-email-proof');
const postForm = document.querySelector('#ecis-registration-post');
const postPayload = document.querySelector('#ecis-registration-payload');
const paymentMethodInputs = Array.from(document.querySelectorAll('input[name="paymentMethod"]'));

const mpCheckout = document.querySelector('#mp-checkout');
const mpConfirmCheckout = document.querySelector('#mp-confirm-checkout');
const mpCheckoutAmount = document.querySelector('#mp-checkout-amount');
const mpPaymentError = document.querySelector('#mp-payment-error');
const mpRedirectButton = document.querySelector('#mp-redirect-button');
const mpHybridOptions = document.querySelector('#mp-hybrid-options');
const mpDone = document.querySelector('#mp-done');
const mpQrImage = document.querySelector('#mp-qr-image');
const mpQrContinue = document.querySelector('#mp-qr-continue');
const mpReopenButton = document.querySelector('#mp-reopen-button');
const paymentBackButtons = Array.from(document.querySelectorAll('[data-payment-back]'));
const mpConfirmBack = document.querySelector('#mp-confirm-back');
const progressData = document.querySelector('#progress-data');
const progressPayment = document.querySelector('#progress-payment');
const progressProof = document.querySelector('#progress-proof');

let paymentDraft = null;
let registrationPostPromise = null;
let paymentCloseWarningActive = false;

function setPaymentCloseWarning(active) {
  paymentCloseWarningActive = Boolean(active);
}

window.addEventListener('beforeunload', event => {
  if (!paymentCloseWarningActive) return;
  event.preventDefault();
  event.returnValue = '';
});

function writePaymentStage(method, stage) {
  if (!paymentDraft) return;
  writeJsonStorage(ECIS_PAYMENT_STAGE_KEY, {
    experienciaId: paymentDraft.experienciaId,
    email: paymentDraft.email,
    method,
    stage
  });
}

function readPaymentStage() {
  const stored = readJsonStorage(ECIS_PAYMENT_STAGE_KEY);
  if (!stored || !paymentDraft) return null;
  if (stored.experienciaId !== paymentDraft.experienciaId) return null;
  if (stored.email !== paymentDraft.email) return null;
  return stored;
}

function clearPaymentStage() {
  removeStorage(ECIS_PAYMENT_STAGE_KEY);
  setPaymentCloseWarning(false);
}

function updateCheckoutProgress(stage = 'payment') {
  [progressData, progressPayment, progressProof].forEach(item => item?.classList.remove('is-current', 'is-complete'));
  progressData?.classList.add('is-complete');
  if (stage === 'proof') {
    progressPayment?.classList.add('is-complete');
    progressProof?.classList.add('is-current');
  } else {
    progressPayment?.classList.add('is-current');
  }
}

function setCheckoutVisibility({ choice = false, transfer = false, mp = false, mpConfirm = false } = {}) {
  if (paymentMethodCard) paymentMethodCard.hidden = !choice;
  if (transferCheckout) transferCheckout.hidden = !transfer;
  if (mpCheckout) mpCheckout.hidden = !mp;
  if (mpConfirmCheckout) mpConfirmCheckout.hidden = !mpConfirm;
}

function showPaymentChoice({ scroll = true } = {}) {
  setCheckoutVisibility({ choice: true });
  clearPaymentStage();
  updateCheckoutProgress('payment');
  if (scroll) smoothScrollTo(paymentMethodCard, 'start');
}

function showTransferStep({ scroll = true } = {}) {
  setCheckoutVisibility({ transfer: true });
  writePaymentStage('Transferencia', 'payment');
  setPaymentCloseWarning(false);
  updateCheckoutProgress('payment');
  if (scroll) smoothScrollTo(transferCheckout, 'start');
}

function showMercadoPagoStep({ scroll = true } = {}) {
  const config = getMpLinkConfig(paymentDraft);
  if (!config) {
    setError(mpPaymentError, 'Elegí transferencia para continuar con esta experiencia.');
    return;
  }
  if (mpCheckoutAmount) mpCheckoutAmount.textContent = formatArs(paymentDraft?.importe);
  if (mpRedirectButton) mpRedirectButton.href = config.url;
  if (mpReopenButton) mpReopenButton.href = config.url;
  if (mpQrImage) mpQrImage.src = config.qr;
  if (mpHybridOptions) mpHybridOptions.hidden = false;
  setCheckoutVisibility({ mp: true });
  writePaymentStage('MercadoPago', 'payment');
  setPaymentCloseWarning(false);
  updateCheckoutProgress('payment');
  if (scroll) smoothScrollTo(mpCheckout, 'start');
}

function showMercadoPagoConfirmation({ scroll = true } = {}) {
  const config = getMpLinkConfig(paymentDraft);
  if (!config) return;
  if (mpReopenButton) mpReopenButton.href = config.url;
  setCheckoutVisibility({ mpConfirm: true });
  writePaymentStage('MercadoPago', 'confirm');
  setPaymentCloseWarning(true);
  updateCheckoutProgress('payment');
  if (scroll) smoothScrollTo(mpConfirmCheckout, 'start');
}

function renderPaymentSummary(data) {
  if (!paymentSummary) return;

  const rows = [
    ['Nombre y apellido', getEnrollmentFullName(data)],
    ['Correo electrónico', data.email],
    ['DNI', data.dni],
    ['Teléfono', data.telefono],
    ['Institución / Organización', data.institucion || 'Información opcional'],
    ['Curso / Experiencia', data.experiencia]
  ];

  paymentSummary.innerHTML = rows.map(([label, value]) => `
    <div class="checkout-summary-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');
}

function buildProofLinks(code, data, method = 'Transferencia') {
  const isMp = method === 'MercadoPagoLink';
  const methodName = isMp ? 'Mercado Pago' : 'transferencia';

  const whatsappText = [
    `Hola ECIS. Realicé el pago mediante ${methodName}.`,
    '',
    `Código de inscripción: ${code}`,
    `Experiencia: ${data.experiencia}`,
    `Importe: ${formatArs(data.importe)}`,
    '',
    'Adjunto el comprobante de pago.'
  ].join('\n');

  const emailSubject = `Comprobante de pago — ${code}`;
  const emailBody = [
    'Hola ECIS:',
    '',
    `Realicé el pago mediante ${methodName}.`,
    `Código de inscripción: ${code}`,
    `Experiencia: ${data.experiencia}`,
    `Importe: ${formatArs(data.importe)}`,
    `Nombre y apellido: ${getEnrollmentFullName(data)}`,
    '',
    'Adjunto el comprobante de pago.',
    '',
    'Saludos.'
  ].join('\n');

  const whatsappHref = `https://wa.me/${ECIS_WHATSAPP}?text=${encodeURIComponent(whatsappText)}`;
  const emailHref = `mailto:${ECIS_EMAIL}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  if (whatsappProof) whatsappProof.href = whatsappHref;
  if (emailProof) emailProof.href = emailHref;
}

function showFinishedState(code, data, method = 'Transferencia') {
  if (!finishedPanel || !paymentFlow) return;
  if (finalRegistrationCode) finalRegistrationCode.textContent = code;
  buildProofLinks(code, data, method);
  removeStorage(ECIS_PAYMENT_STAGE_KEY);
  setPaymentCloseWarning(true);
  updateCheckoutProgress('proof');
  paymentFlow.hidden = true;
  finishedPanel.hidden = false;
  smoothScrollTo(finishedPanel, 'start');
}

function submitRegistrationThroughIframe(payload) {
  if (!postForm || !postPayload) throw new Error('Recargá esta página para preparar nuevamente el registro.');
  postForm.action = ECIS_ENDPOINT;
  postForm.target = 'ecis-registration-frame';
  postPayload.value = JSON.stringify(payload);
  postForm.submit();
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
      settled = true;
      cleanup();
      reject(new Error('La conexión sigue en curso.'));
    }, timeoutMs);

    window[callbackName] = data => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve(data || { resultado: 'pendiente' });
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('La respuesta sigue en curso.'));
    };

    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=consultar_registro&registroId=${encodeURIComponent(registroId)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

async function esperarRegistroPorConsulta(registroId, totalMs = getNetworkProfile().registrationWindow, onProgress = () => {}) {
  const startedAt = Date.now();
  let attempt = 0;
  let serverError = null;

  while (Date.now() - startedAt < totalMs) {
    await waitForConnection();
    const elapsed = Date.now() - startedAt;
    onProgress(elapsed);

    try {
      const data = await consultarRegistroJsonp(registroId);
      if (data?.resultado === 'ok' && data?.codigo) return data;
      if (data?.resultado === 'error') {
        serverError = new Error(data.mensaje || 'ECIS necesita revisar los datos de la inscripción.');
        break;
      }
    } catch (_) {
      // Una consulta lenta se reintenta automáticamente. El registro conserva el mismo UUID.
    }

    await new Promise(resolve => window.setTimeout(resolve, adaptiveDelay(attempt)));
    attempt += 1;
  }

  if (serverError) throw serverError;
  const recoverable = new Error('Tu inscripción sigue guardada en este dispositivo. Cuando tengas conexión, tocá “Recuperar mi código” para continuar.');
  recoverable.recoverable = true;
  throw recoverable;
}

function postRegistrationAndWait(payload, onProgress = () => {}) {
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
      const data = event?.data;
      if (!data || data.source !== 'ecis-registration') return;
      if (String(data.registroId || '') !== String(payload.registroId || '')) return;

      if (data.resultado === 'ok' && data.codigo) {
        finish(resolve, data);
        return;
      }

      if (data.resultado === 'error') {
        finish(reject, new Error(data.mensaje || 'ECIS necesita revisar la inscripción.'));
      }
    };

    window.addEventListener('message', onMessage);

    try {
      submitRegistrationThroughIframe(payload);
    } catch (error) {
      finish(reject, error);
      return;
    }

    // Respaldo robusto: aunque el iframe termine en Apps Script y el navegador
    // no reciba el postMessage, consultamos el registro por su UUID hasta
    // recuperar el mismo código ya guardado en la planilla.
    esperarRegistroPorConsulta(payload.registroId, getNetworkProfile().registrationWindow, onProgress)
      .then(data => finish(resolve, data))
      .catch(error => finish(reject, error));
  }).finally(() => {
    registrationPostPromise = null;
  });

  return registrationPostPromise;
}

function getPreviousResultForDraft() {
  const previous = readJsonStorage(ECIS_RESULT_KEY);
  if (!previous || !paymentDraft) return null;
  if (previous.experienciaId !== paymentDraft.experienciaId) return null;
  if (previous.email !== paymentDraft.email) return null;
  return previous;
}

function configureMpAvailability() {
  const mpInput = paymentMethodInputs.find(input => input.value === 'MercadoPago');
  if (!mpInput || !paymentDraft) return;

  const config = getMpLinkConfig(paymentDraft);
  const methodCard = mpInput.closest('.payment-method');
  const helper = methodCard?.querySelector('small');

  if (!config) {
    mpInput.disabled = true;
    methodCard?.classList.add('is-disabled');
    if (helper) helper.textContent = 'Disponible mediante transferencia';
    if (mpInput.checked) {
      const transferInput = paymentMethodInputs.find(input => input.value === 'Transferencia');
      if (transferInput) transferInput.checked = true;
    }
    return;
  }

  mpInput.disabled = false;
  methodCard?.classList.remove('is-disabled');
  if (helper) helper.textContent = 'App de Mercado Pago, crédito, débito y medios disponibles';
  if (mpQrImage) mpQrImage.src = config.qr;
}

function updatePaymentMethodSelection() {
  paymentMethodInputs.forEach(input => {
    input.closest('.payment-method')?.classList.toggle('is-selected', input.checked);
  });

  const selected = paymentMethodInputs.find(input => input.checked)?.value || 'Transferencia';
  if (paymentProceed) {
    paymentProceed.textContent = selected === 'MercadoPago'
      ? 'Continuar con Mercado Pago →'
      : 'Continuar con transferencia →';
  }
}

function showMercadoPagoOptions() {
  showMercadoPagoStep();
}

async function registerPaidEnrollment(action, methodKey, methodLabel, button, errorElement) {
  if (!paymentDraft || !button) return;
  setError(errorElement, '');

  const previous = getPreviousResultForDraft();
  if (previous?.medioPago === methodKey && previous?.codigo) {
    showFinishedState(previous.codigo, paymentDraft, methodKey);
    return;
  }

  const originalText = button.textContent;
  let finalButtonText = originalText;
  button.disabled = true;
  button.textContent = 'Registrando inscripción…';

  const updateProgress = elapsed => {
    if (navigator.onLine === false) button.textContent = 'Esperando señal para continuar…';
    else if (elapsed > 45000) button.textContent = 'Seguimos recuperando tu código…';
    else if (elapsed > 15000) button.textContent = 'Conexión en curso…';
    else if (elapsed > 3500) button.textContent = 'Recuperando tu código…';
  };

  try {
    const registroId = getRegistrationAttemptId(methodKey);
    const payload = {
      accion: action,
      registroId,
      nombre: paymentDraft.nombre,
      apellido: paymentDraft.apellido || '',
      dni: paymentDraft.dni,
      email: paymentDraft.email,
      telefono: paymentDraft.telefono,
      institucion: paymentDraft.institucion || '',
      experienciaId: paymentDraft.experienciaId
    };

    const response = await postRegistrationAndWait(payload, updateProgress);
    const codigo = String(response?.codigo || '').trim();
    if (!codigo) { const error = new Error('Tu inscripción quedó registrada. Tocá “Recuperar mi código” para mostrar el código y continuar.'); error.recoverable = true; throw error; }

    writeJsonStorage(ECIS_RESULT_KEY, {
      codigo,
      experienciaId: paymentDraft.experienciaId,
      email: paymentDraft.email,
      medioPago: methodKey,
      resultado: 'pendiente'
    });

    showFinishedState(codigo, paymentDraft, methodKey);
  } catch (error) {
    if (error?.recoverable) finalButtonText = 'Recuperar mi código →';
    setError(errorElement, error?.message || `Tocá nuevamente el botón para continuar con ${methodLabel}.`);
  } finally {
    button.disabled = false;
    button.textContent = finalButtonText;
  }
}

async function recuperarRegistroPendienteAlCargar() {
  if (!paymentDraft) return false;

  const candidates = [
    ['Transferencia', 'Transferencia'],
    ['MercadoPagoLink', 'MercadoPagoLink']
  ];

  for (const [suffix, methodKey] of candidates) {
    const storageKey = ECIS_REGISTRATION_ATTEMPT_PREFIX + suffix.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    let registroId = '';
    try {
      registroId = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey) || '';
      if (registroId && !localStorage.getItem(storageKey)) localStorage.setItem(storageKey, registroId);
    } catch (_) {}
    if (!registroId) continue;

    try {
      const data = await consultarRegistroJsonp(registroId, getNetworkProfile().requestTimeout);
      if (data?.resultado === 'ok' && data?.codigo) {
        const codigo = String(data.codigo).trim();
        writeJsonStorage(ECIS_RESULT_KEY, {
          codigo,
          experienciaId: paymentDraft.experienciaId,
          email: paymentDraft.email,
          medioPago: methodKey,
          resultado: 'pendiente'
        });
        showFinishedState(codigo, paymentDraft, methodKey);
        return true;
      }
    } catch (_) {}
  }

  return false;
}

async function initializePaymentPage() {
  if (!paymentSummary) return;

  paymentDraft = normalizeEnrollmentData(readJsonStorage(ECIS_STORAGE_KEY));
  if (paymentDraft) writeJsonStorage(ECIS_STORAGE_KEY, paymentDraft);
  if (!paymentDraft?.experienciaId) {
    window.location.replace('inscripcion.html');
    return;
  }

  renderPaymentSummary(paymentDraft);
  if (paymentAmount) paymentAmount.textContent = formatArs(paymentDraft.importe);
  if (transferAmount) transferAmount.textContent = formatArs(paymentDraft.importe);
  if (mpCheckoutAmount) mpCheckoutAmount.textContent = formatArs(paymentDraft.importe);

  configureMpAvailability();

  const previous = getPreviousResultForDraft();
  if (previous?.codigo) {
    showFinishedState(previous.codigo, paymentDraft, previous.medioPago || 'Transferencia');
    return;
  }

  if (await recuperarRegistroPendienteAlCargar()) return;

  updatePaymentMethodSelection();
  updateCheckoutProgress('payment');

  const stage = readPaymentStage();
  if (stage?.method === 'Transferencia' && stage?.stage === 'payment') {
    showTransferStep({ scroll: false });
    return;
  }
  if (stage?.method === 'MercadoPago' && stage?.stage === 'confirm') {
    showMercadoPagoConfirmation({ scroll: false });
    return;
  }
  if (stage?.method === 'MercadoPago' && stage?.stage === 'payment') {
    showMercadoPagoStep({ scroll: false });
    return;
  }

  setCheckoutVisibility({ choice: true });
}

paymentMethodInputs.forEach(input => {
  input.addEventListener('change', () => {
    updatePaymentMethodSelection();
    setError(paymentError, '');
    setError(mpPaymentError, '');
  });
});

paymentProceed?.addEventListener('click', () => {
  const selected = paymentMethodInputs.find(input => input.checked)?.value || 'Transferencia';
  setError(paymentError, '');
  setError(mpPaymentError, '');
  if (selected === 'MercadoPago') {
    showMercadoPagoStep();
    return;
  }
  showTransferStep();
});

paymentBackButtons.forEach(button => {
  button.addEventListener('click', () => showPaymentChoice());
});

mpConfirmBack?.addEventListener('click', () => showMercadoPagoStep());

mpRedirectButton?.addEventListener('click', () => {
  showMercadoPagoConfirmation({ scroll: true });
});

mpQrContinue?.addEventListener('click', () => {
  setPaymentCloseWarning(true);
  registerPaidEnrollment(
    'mercadopago_link',
    'MercadoPagoLink',
    'Mercado Pago',
    mpQrContinue,
    mpPaymentError
  );
});

mpReopenButton?.addEventListener('click', () => {
  setPaymentCloseWarning(true);
  writePaymentStage('MercadoPago', 'confirm');
});

copyTransferAlias?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('lucas.eci');
    const original = copyTransferAlias.textContent;
    copyTransferAlias.textContent = 'Copiado';
    window.setTimeout(() => { copyTransferAlias.textContent = original; }, 1600);
  } catch (_) {
    window.prompt('Copiá el alias:', 'lucas.eci');
  }
});

copyRegistrationCode?.addEventListener('click', async () => {
  const code = finalRegistrationCode?.textContent?.trim();
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    const original = copyRegistrationCode.textContent || 'Copiar código';
    copyRegistrationCode.textContent = 'Código copiado';
    window.setTimeout(() => { copyRegistrationCode.textContent = original; }, 1600);
  } catch (_) {
    window.prompt('Copiá tu código:', code);
  }
});

transferDone?.addEventListener('click', () => {
  registerPaidEnrollment(
    'transferencia',
    'Transferencia',
    'transferencia',
    transferDone,
    paymentError
  );
});

mpDone?.addEventListener('click', () => {
  registerPaidEnrollment(
    'mercadopago_link',
    'MercadoPagoLink',
    'Mercado Pago',
    mpDone,
    mpPaymentError
  );
});


document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !paymentDraft) return;
  const stage = readPaymentStage();
  if (stage?.method === 'MercadoPago' && stage?.stage === 'confirm' && finishedPanel?.hidden !== false) {
    showMercadoPagoConfirmation({ scroll: true });
  }
});

window.addEventListener('pageshow', () => {
  if (!paymentDraft) return;
  const stage = readPaymentStage();
  if (stage?.method === 'MercadoPago' && stage?.stage === 'confirm' && finishedPanel?.hidden !== false) {
    window.setTimeout(() => showMercadoPagoConfirmation({ scroll: true }), 80);
  }
});


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

  if (prefersReducedMotion()) {
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

  const parallaxImages = Array.from(document.querySelectorAll('.hero-media img, .profile-editorial-image img, .course-image img'));
  if (parallaxImages.length && window.matchMedia('(min-width: 701px)').matches) {
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight || 800;
      parallaxImages.forEach(img => {
        const holder = img.closest('.parallax-media');
        if (!holder) return;
        const rect = holder.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > vh) return;
        const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
        img.style.transform = `scale(1.035) translate3d(0, ${progress * -10}px, 0)`;
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }
}

function initializePremiumMicroInteractions() {
  if (prefersReducedMotion()) return;
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

whatsappProof?.addEventListener('click', () => setPaymentCloseWarning(false));
emailProof?.addEventListener('click', () => setPaymentCloseWarning(false));
initializeInputGuards();
initializeNetworkStatus();
initializeArtDirection109();
initializePremiumMicroInteractions();
initializePaymentPage();
