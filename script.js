// =========================================================
// ECIS — sitio web limpio 105
// Navegación, contacto, inscripción y pago híbrido Link + QR
// =========================================================

const ECIS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwm5voUlP5k02F-bNalKUkUknY2SvKe6PVpgOivqn8z0zKPKHNzGmII0UNxJLfljTkp/exec';
const ECIS_STORAGE_KEY = 'ecis_enrollment_draft';
const ECIS_RESULT_KEY = 'ecis_enrollment_result';
const ECIS_REGISTRATION_ATTEMPT_PREFIX = 'ecis_registration_attempt_';
const ECIS_PAYMENT_STAGE_KEY = 'ecis_payment_stage';
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

function smoothScrollTo(element, block = 'center') {
  element?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block });
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
      throw new Error(data.message || 'No se pudo enviar el formulario.');
    }

    contactForm.reset();
    if (formStatus) {
      formStatus.textContent = 'Gracias por comunicarte con ECIS. Recibimos tu consulta y te responderemos a la brevedad.';
      formStatus.hidden = false;
      formStatus.focus({ preventScroll: true });
    }
  } catch (_) {
    if (formStatus) {
      formStatus.textContent = 'No pudimos enviar tu consulta en este momento. Intentá nuevamente o comunicate con ECIS por correo electrónico o WhatsApp.';
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

function loadExperiencesJsonp(timeoutMs = 12000) {
  if (!experienceSelect) return Promise.resolve([]);

  experienceSelect.disabled = true;
  experienceSelect.innerHTML = '<option value="">Cargando experiencias…</option>';
  if (experienceRetry) experienceRetry.hidden = true;
  setError(enrollmentError, '');

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
      reject(new Error('Tiempo de espera agotado.'));
    }, timeoutMs);

    window[callbackName] = data => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();

      if (!data || data.resultado !== 'ok' || !Array.isArray(data.experiencias)) {
        reject(new Error(data?.mensaje || 'No se pudieron cargar las experiencias.'));
        return;
      }
      resolve(data.experiencias);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('No se pudieron cargar las experiencias.'));
    };

    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=experiencias&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

async function populateExperiences() {
  if (!experienceSelect) return;

  try {
    loadedExperiences = await loadExperiencesJsonp();
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
    if (experienceHelp) {
      experienceHelp.textContent = loadedExperiences.length
        ? 'El importe correspondiente se mostrará en el siguiente paso.'
        : 'No hay experiencias disponibles en este momento.';
    }

    const draft = readJsonStorage(ECIS_STORAGE_KEY);
    const requestedId = new URLSearchParams(window.location.search).get('experiencia');
    const preferredId = requestedId || draft?.experienciaId || '';

    if (preferredId && loadedExperiences.some(item => String(item.id) === String(preferredId))) {
      experienceSelect.value = String(preferredId);
    }
  } catch (_) {
    experienceSelect.innerHTML = '<option value="">No se pudieron cargar las experiencias</option>';
    experienceSelect.disabled = true;
    if (experienceHelp) experienceHelp.textContent = 'Verificá tu conexión e intentá nuevamente.';
    if (experienceRetry) experienceRetry.hidden = false;
    setError(enrollmentError, 'No pudimos cargar las experiencias disponibles.');
  }
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
      setError(enrollmentError, 'No pudimos obtener los datos de la experiencia seleccionada. Reintentá la carga.');
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
    setError(mpPaymentError, 'Mercado Pago no está disponible para esta experiencia.');
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
    ['Institución / Organización', data.institucion || 'No informada'],
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
  clearPaymentStage();
  updateCheckoutProgress('proof');
  paymentFlow.hidden = true;
  finishedPanel.hidden = false;
  smoothScrollTo(finishedPanel, 'start');
}

function submitRegistrationThroughIframe(payload) {
  if (!postForm || !postPayload) throw new Error('No se pudo preparar el registro.');
  postForm.action = ECIS_ENDPOINT;
  postForm.target = 'ecis-registration-frame';
  postPayload.value = JSON.stringify(payload);
  postForm.submit();
}

function consultarRegistroJsonp(registroId, timeoutMs = 12000) {
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
      reject(new Error('La consulta del código está demorando.'));
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
      reject(new Error('No se pudo consultar el código.'));
    };

    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=consultar_registro&registroId=${encodeURIComponent(registroId)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

async function esperarRegistroPorConsulta(registroId, totalMs = 90000) {
  const startedAt = Date.now();
  let ultimoError = null;

  while (Date.now() - startedAt < totalMs) {
    try {
      const data = await consultarRegistroJsonp(registroId);
      if (data?.resultado === 'ok' && data?.codigo) return data;
      if (data?.resultado === 'error') {
        throw new Error(data.mensaje || 'No pudimos recuperar el código de inscripción.');
      }
    } catch (error) {
      ultimoError = error;
    }

    await new Promise(resolve => window.setTimeout(resolve, 1400));
  }

  throw ultimoError || new Error('La inscripción se registró, pero todavía no pudimos recuperar el código. Actualizá la página para intentarlo nuevamente.');
}

function postRegistrationAndWait(payload) {
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
        finish(reject, new Error(data.mensaje || 'No pudimos registrar la inscripción.'));
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
    esperarRegistroPorConsulta(payload.registroId)
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
    if (helper) helper.textContent = 'No disponible para esta experiencia';
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
  button.disabled = true;
  button.textContent = 'Generando código…';

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

    const response = await postRegistrationAndWait(payload);
    const codigo = String(response?.codigo || '').trim();
    if (!codigo) throw new Error('La inscripción se registró sin devolver un código. Contactá a ECIS.');

    writeJsonStorage(ECIS_RESULT_KEY, {
      codigo,
      experienciaId: paymentDraft.experienciaId,
      email: paymentDraft.email,
      medioPago: methodKey,
      resultado: 'pendiente'
    });

    showFinishedState(codigo, paymentDraft, methodKey);
  } catch (error) {
    setError(errorElement, error?.message || `No pudimos registrar tu pago por ${methodLabel}. Intentá nuevamente.`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
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
      const data = await consultarRegistroJsonp(registroId, 8000);
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

  paymentDraft = readJsonStorage(ECIS_STORAGE_KEY);
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

mpQrContinue?.addEventListener('click', () => showMercadoPagoConfirmation());

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

initializePaymentPage();
