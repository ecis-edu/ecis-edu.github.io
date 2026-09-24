// =========================================================
// ECIS — navegación, contacto e inscripción
// =========================================================

const ECIS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwm5voUlP5k02F-bNalKUkUknY2SvKe6PVpgOivqn8z0zKPKHNzGmII0UNxJLfljTkp/exec';
const ECIS_STORAGE_KEY = 'ecis_enrollment_draft';
const ECIS_RESULT_KEY = 'ecis_enrollment_result';
const ECIS_WHATSAPP = '5401136741338';
const ECIS_EMAIL = 'ecis.ar.edu@gmail.com';
const ECIS_MP_ORDER_KEY = 'ecis_mp_order';
const ECIS_MP_ATTEMPT_KEY = 'ecis_mp_attempt';

// Año del footer
document.querySelectorAll('#year').forEach(el => {
  el.textContent = new Date().getFullYear();
});

// Navegación móvil
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');

menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!open));
  menuToggle.setAttribute('aria-label', open ? 'Abrir menú' : 'Cerrar menú');
  nav?.classList.toggle('is-open', !open);
  document.body.classList.toggle('nav-open', !open);
});

nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Abrir menú');
  nav?.classList.remove('is-open');
  document.body.classList.remove('nav-open');
}));

const currentFile = window.location.pathname.split('/').pop() || 'index.html';
nav?.querySelectorAll('a').forEach(link => {
  if (link.getAttribute('href') === currentFile) link.setAttribute('aria-current', 'page');
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav?.classList.contains('is-open')) {
    nav.classList.remove('is-open');
    document.body.classList.remove('nav-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Abrir menú');
    menuToggle?.focus();
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 860 && nav?.classList.contains('is-open')) {
    nav.classList.remove('is-open');
    document.body.classList.remove('nav-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Abrir menú');
  }
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
    const requestTimeout = window.setTimeout(() => controller.abort(), 20000);

    let response;
    try {
      response = await fetch(contactForm.dataset.formsubmitAjax, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(requestTimeout);
    }

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
// Utilidades de inscripción
// =========================================================
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

function formatArs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const formatted = new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 0
  }).format(number);
  return `ARS $${formatted}`;
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

// =========================================================
// Página 1 — inscripcion.html
// =========================================================
const enrollmentForm = document.querySelector('#ecis-enrollment-form');
const experienceSelect = document.querySelector('#enroll-experience');
const experienceHelp = document.querySelector('#experience-help');
const experienceRetry = document.querySelector('#experience-retry');
const enrollmentError = document.querySelector('#enrollment-error');

let loadedExperiences = [];

function loadExperiencesJsonp() {
  if (!experienceSelect) return Promise.resolve([]);

  experienceSelect.disabled = true;
  experienceSelect.innerHTML = '<option value="">Cargando experiencias…</option>';
  experienceRetry.hidden = true;
  setError(enrollmentError, '');

  return new Promise((resolve, reject) => {
    const callbackName = `ecisExperiencias_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      script.remove();
    };

    window[callbackName] = data => {
      if (settled) return;
      settled = true;
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

    experienceSelect.disabled = false;
    experienceHelp.textContent = loadedExperiences.length
      ? 'El importe correspondiente se mostrará en el siguiente paso.'
      : 'No hay experiencias disponibles en este momento.';

    const draft = readJsonStorage(ECIS_STORAGE_KEY);
    const requestedId = new URLSearchParams(window.location.search).get('experiencia');
    const preferredId = requestedId || draft?.experienciaId || '';

    if (preferredId && loadedExperiences.some(item => String(item.id) === String(preferredId))) {
      experienceSelect.value = String(preferredId);
    }

    if (!loadedExperiences.length) experienceSelect.disabled = true;
  } catch (_) {
    experienceSelect.innerHTML = '<option value="">No se pudieron cargar las experiencias</option>';
    experienceSelect.disabled = true;
    experienceHelp.textContent = 'Verificá tu conexión e intentá nuevamente.';
    experienceRetry.hidden = false;
    setError(enrollmentError, 'No pudimos cargar las experiencias disponibles.');
  }
}

function restoreEnrollmentDraft() {
  if (!enrollmentForm) return;
  const draft = readJsonStorage(ECIS_STORAGE_KEY);
  if (!draft) return;

  const mapping = {
    nombre: '#enroll-name',
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
    if (!selected || !selected.value) {
      setError(enrollmentError, 'Seleccioná una experiencia para continuar.');
      experienceSelect?.focus();
      return;
    }

    const data = {
      nombre: String(document.querySelector('#enroll-name')?.value || '').trim(),
      email: String(document.querySelector('#enroll-email')?.value || '').trim(),
      dni: String(document.querySelector('#enroll-dni')?.value || '').trim(),
      telefono: String(document.querySelector('#enroll-phone')?.value || '').trim(),
      institucion: String(document.querySelector('#enroll-institution')?.value || '').trim(),
      experienciaId: selected.value,
      experiencia: selected.dataset.name || selected.textContent || '',
      tipo: selected.dataset.type || '',
      importe: Number(selected.dataset.amount || 0)
    };

    if (!data.experienciaId || !data.experiencia || !Number.isFinite(data.importe) || data.importe <= 0) {
      setError(enrollmentError, 'No pudimos obtener los datos de la experiencia seleccionada. Reintentá la carga.');
      return;
    }

    writeJsonStorage(ECIS_STORAGE_KEY, data);
    removeStorage(ECIS_RESULT_KEY);
    removeStorage(ECIS_MP_ORDER_KEY);
    removeStorage(ECIS_MP_ATTEMPT_KEY);
    window.location.href = 'pago.html';
  });
}

// =========================================================
// Página 2 — pago.html
// =========================================================
const paymentSummary = document.querySelector('#payment-summary');
const paymentAmount = document.querySelector('#payment-amount');
const transferAmount = document.querySelector('#transfer-amount');
const paymentProceed = document.querySelector('#payment-proceed');
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
const registrationFrame = document.querySelector('#ecis-registration-frame');
const paymentMethodInputs = Array.from(document.querySelectorAll('input[name="paymentMethod"]'));

const mpCheckout = document.querySelector('#mp-checkout');
const mpReservedCode = document.querySelector('#mp-reserved-code');
const mpCheckoutAmount = document.querySelector('#mp-checkout-amount');
const mpPaymentError = document.querySelector('#mp-payment-error');
const mpWaitMessage = document.querySelector('#mp-wait-message');
const mpRedirectButton = document.querySelector('#mp-redirect-button');
const mpResultPanel = document.querySelector('#mp-result-panel');
const mpResultCheck = document.querySelector('#mp-result-check');
const mpResultTitle = document.querySelector('#mp-result-title');
const mpResultCode = document.querySelector('#mp-result-code');
const copyMpResultCode = document.querySelector('#copy-mp-result-code');
const mpResultMessage = document.querySelector('#mp-result-message');
const mpResultDetail = document.querySelector('#mp-result-detail');
const mpRetryPayment = document.querySelector('#mp-retry-payment');

let paymentDraft = null;
let reservedRegistrationCode = '';
let registrationCodePromise = null;
let iframeResponseWaiter = null;

function renderPaymentSummary(data) {
  if (!paymentSummary) return;

  const rows = [
    ['Nombre y apellido', data.nombre],
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

function buildProofLinks(code, data) {
  const whatsappText = [
    'Hola ECIS. Realicé el pago correspondiente a mi inscripción.',
    '',
    `Código de inscripción: ${code}`,
    `Experiencia: ${data.experiencia}`,
    '',
    'Adjunto el comprobante de transferencia.'
  ].join('\n');

  const emailSubject = `Comprobante de pago — ${code}`;
  const emailBody = [
    'Hola ECIS:',
    '',
    'Envío el comprobante correspondiente a mi inscripción.',
    '',
    `Código de inscripción: ${code}`,
    `Experiencia: ${data.experiencia}`,
    `Nombre y apellido: ${data.nombre}`,
    '',
    'Adjunto el comprobante de transferencia.',
    '',
    'Saludos.'
  ].join('\n');

  if (whatsappProof) {
    whatsappProof.href = `https://wa.me/${ECIS_WHATSAPP}?text=${encodeURIComponent(whatsappText)}`;
  }
  if (emailProof) {
    emailProof.href = `mailto:${ECIS_EMAIL}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
  }
}

function showFinishedState(code, data) {
  if (!finishedPanel || !paymentFlow) return;
  finalRegistrationCode.textContent = code;
  buildProofLinks(code, data);
  paymentFlow.hidden = true;
  if (mpResultPanel) mpResultPanel.hidden = true;
  finishedPanel.hidden = false;
  finishedPanel.focus({ preventScroll: true });
  finishedPanel.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function showMpResultState({ code, status = 'verificando', message = '', detail = '' }) {
  if (!mpResultPanel || !paymentFlow) return;

  const normalized = String(status || 'verificando').toLowerCase();
  const presets = {
    verificando: {
      symbol: '…',
      title: 'Verificando pago',
      message: 'Estamos consultando el estado de la operación directamente con Mercado Pago.',
      detail: 'La pantalla se actualizará cuando recibamos la respuesta.'
    },
    aprobado: {
      symbol: '✓',
      title: 'Pago aprobado',
      message: 'Mercado Pago confirmó tu pago.',
      detail: 'Tu inscripción quedó identificada con el código que aparece arriba. Guardalo como referencia.'
    },
    pendiente: {
      symbol: '…',
      title: 'Pago pendiente',
      message: 'Mercado Pago todavía está procesando la operación.',
      detail: 'No es necesario volver a pagar. Conservá tu código ECIS mientras el estado se actualiza.'
    },
    rechazado: {
      symbol: '!',
      title: 'El pago no se completó',
      message: 'Mercado Pago informó que la operación no fue aprobada.',
      detail: 'Podés volver a intentarlo y elegir nuevamente el medio de pago dentro de Mercado Pago.'
    },
    error: {
      symbol: '!',
      title: 'No pudimos verificar el pago',
      message: 'No logramos consultar el estado final de la operación en este momento.',
      detail: 'Conservá tu código ECIS. Podés reintentar la verificación recargando esta página o comunicarte con ECIS.'
    }
  };

  const preset = presets[normalized] || presets.verificando;

  if (mpResultCheck) {
    mpResultCheck.textContent = preset.symbol;
    mpResultCheck.dataset.status = normalized;
  }
  if (mpResultTitle) mpResultTitle.textContent = preset.title;
  if (mpResultCode) mpResultCode.textContent = code || 'ECIS';
  if (mpResultMessage) mpResultMessage.textContent = message || preset.message;
  if (mpResultDetail) mpResultDetail.innerHTML = `<p>${escapeHtml(detail || preset.detail)}</p>`;

  if (mpRetryPayment) mpRetryPayment.hidden = normalized !== 'rechazado';

  const wasHidden = mpResultPanel.hidden;
  paymentFlow.hidden = true;
  if (finishedPanel) finishedPanel.hidden = true;
  mpResultPanel.hidden = false;
  if (wasHidden) mpResultPanel.focus({ preventScroll: true });
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

function submitRegistrationThroughIframe(data) {
  if (!postForm || !postPayload) throw new Error('No se pudo preparar el registro.');
  postForm.action = ECIS_ENDPOINT;
  postPayload.value = JSON.stringify(data);
  postForm.submit();
}

function reserveRegistrationCodeJsonp(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const callbackName = `ecisCode_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
      reject(new Error('La generación del código está demorando más de lo esperado.'));
    }, timeoutMs);

    window[callbackName] = data => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();

      if (!data || data.resultado !== 'ok' || !data.codigo) {
        reject(new Error(data?.mensaje || 'No pudimos generar el código de inscripción.'));
        return;
      }

      resolve(String(data.codigo));
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('No pudimos comunicarnos con el sistema de inscripción.'));
    };

    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=reservar_codigo&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

async function ensureRegistrationCode() {
  if (reservedRegistrationCode) return reservedRegistrationCode;

  const storedOrder = readJsonStorage(ECIS_MP_ORDER_KEY);
  const storedOrderMatchesDraft = Boolean(
    storedOrder?.codigo &&
    /^ECIS-\d{4,}$/.test(storedOrder.codigo) &&
    paymentDraft?.experienciaId &&
    storedOrder.experienciaId === paymentDraft.experienciaId &&
    storedOrder.email === paymentDraft.email
  );

  if (storedOrderMatchesDraft) {
    reservedRegistrationCode = storedOrder.codigo;
    if (mpReservedCode) mpReservedCode.textContent = reservedRegistrationCode;
    return reservedRegistrationCode;
  }

  if (storedOrder?.codigo && !storedOrderMatchesDraft) {
    removeStorage(ECIS_MP_ORDER_KEY);
    clearMpAttemptId();
  }

  if (!registrationCodePromise) {
    registrationCodePromise = reserveRegistrationCodeJsonp()
      .then(code => {
        reservedRegistrationCode = code;
        if (mpReservedCode) mpReservedCode.textContent = code;
        return code;
      })
      .finally(() => {
        registrationCodePromise = null;
      });
  }

  return registrationCodePromise;
}

function createUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

function getOrCreateMpAttemptId() {
  try {
    const existing = sessionStorage.getItem(ECIS_MP_ATTEMPT_KEY);
    if (existing) return existing;
    const created = createUuid();
    sessionStorage.setItem(ECIS_MP_ATTEMPT_KEY, created);
    return created;
  } catch (_) {
    return createUuid();
  }
}

function clearMpAttemptId() {
  try { sessionStorage.removeItem(ECIS_MP_ATTEMPT_KEY); } catch (_) {}
}

function getReturnBaseUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.href;
}

function isTrustedMercadoPagoCheckoutUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();
    return host === 'mercadopago.com.ar' ||
      host.endsWith('.mercadopago.com.ar') ||
      host === 'mercadopago.com' ||
      host.endsWith('.mercadopago.com');
  } catch (_) {
    return false;
  }
}

function submitThroughRegistrationFrame(payload, {
  expectedSource,
  timeoutMs = 30000,
  timeoutMessage = 'La operación está demorando más de lo esperado.'
} = {}) {
  if (!registrationFrame || !expectedSource) {
    return Promise.reject(new Error('No se pudo preparar la comunicación con el sistema de inscripción.'));
  }

  if (iframeResponseWaiter) {
    return Promise.reject(new Error('Ya hay una operación en curso. Esperá unos segundos.'));
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      iframeResponseWaiter = null;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    iframeResponseWaiter = { resolve, reject, timer, expectedSource };

    try {
      submitRegistrationThroughIframe(payload);
    } catch (error) {
      window.clearTimeout(timer);
      iframeResponseWaiter = null;
      reject(error);
    }
  });
}

function submitCheckoutProThroughIframe(payload) {
  return submitThroughRegistrationFrame(payload, {
    expectedSource: 'ecis-mercadopago-checkout',
    timeoutMs: 45000,
    timeoutMessage: 'Mercado Pago está demorando más de lo esperado. Podés volver a intentar sin riesgo de duplicar el cobro.'
  }).then(data => {
    if (data.resultado !== 'redirect' || !data.checkoutUrl) {
      throw new Error(data.mensaje || 'No pudimos preparar el checkout de Mercado Pago.');
    }

    if (!isTrustedMercadoPagoCheckoutUrl(data.checkoutUrl)) {
      throw new Error('Mercado Pago devolvió una dirección de checkout no válida.');
    }

    return data;
  });
}

function submitTransferRegistrationThroughIframe(payload) {
  return submitThroughRegistrationFrame(payload, {
    expectedSource: 'ecis-inscripciones',
    timeoutMs: 30000,
    timeoutMessage: 'El registro está demorando más de lo esperado. Intentá nuevamente en unos segundos.'
  }).then(data => {
    if (data.resultado !== 'ok' || !data.codigo) {
      throw new Error(data.mensaje || 'No pudimos registrar la inscripción.');
    }
    return data;
  });
}

window.addEventListener('message', event => {
  const data = event?.data;
  if (!data || typeof data !== 'object' || !iframeResponseWaiter) return;

  // Solo aceptamos mensajes provenientes del iframe oculto que usamos para
  // comunicarnos con Apps Script. Esto evita que otra pestaña o script pueda
  // simular una respuesta de inscripción o de Mercado Pago.
  if (registrationFrame?.contentWindow && event.source !== registrationFrame.contentWindow) return;
  if (data.source !== iframeResponseWaiter.expectedSource) return;

  const waiter = iframeResponseWaiter;
  iframeResponseWaiter = null;
  window.clearTimeout(waiter.timer);

  if (data.resultado === 'error') {
    waiter.reject(new Error(data.mensaje || 'La operación no pudo completarse.'));
    return;
  }

  waiter.resolve(data);
});

function consultarOrdenMercadoPagoJsonp(codigo, orderId, retorno = '', timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!codigo || !orderId) {
      reject(new Error('No encontramos los datos necesarios para verificar la operación.'));
      return;
    }

    const callbackName = `ecisMpVerify_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
      reject(new Error('La verificación está demorando más de lo esperado.'));
    }, timeoutMs);

    window[callbackName] = data => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve(data || null);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('No pudimos consultar Mercado Pago.'));
    };

    const separator = ECIS_ENDPOINT.includes('?') ? '&' : '?';
    script.src = `${ECIS_ENDPOINT}${separator}accion=verificar_checkout_mp&codigo=${encodeURIComponent(codigo)}&orderId=${encodeURIComponent(orderId)}&retorno=${encodeURIComponent(retorno)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

function getMpReturnInfo() {
  const params = new URLSearchParams(window.location.search);
  const explicitResult = params.get('mp_result');
  const hasMpParams = explicitResult || params.get('order_id') || params.get('external_reference') || params.get('payment_id');
  if (!hasMpParams) return null;

  const stored = readJsonStorage(ECIS_MP_ORDER_KEY) || {};

  return {
    routeResult: explicitResult || params.get('status') || params.get('collection_status') || '',
    codigo: params.get('external_reference') || params.get('codigo') || stored.codigo || reservedRegistrationCode || '',
    orderId: params.get('order_id') || stored.orderId || '',
    paymentId: params.get('payment_id') || params.get('collection_id') || '',
    status: params.get('status') || params.get('collection_status') || ''
  };
}

async function verifyReturnedMercadoPagoPayment(info) {
  const code = info?.codigo || '';
  const orderId = info?.orderId || '';

  showMpResultState({ code, status: 'verificando' });

  if (!code || !orderId) {
    const routeStatus = String(info?.routeResult || info?.status || '').toLowerCase();
    if (routeStatus === 'failure' || routeStatus === 'rejected') {
      showMpResultState({ code, status: 'rechazado' });
      clearMpAttemptId();
      return;
    }

    showMpResultState({
      code,
      status: 'error',
      detail: 'Mercado Pago nos devolvió a ECIS, pero faltan datos para consultar la operación automáticamente.'
    });
    return;
  }

  try {
    const result = await consultarOrdenMercadoPagoJsonp(code, orderId, info?.routeResult || info?.status || '');

    if (!result || result.resultado === 'error') {
      throw new Error(result?.mensaje || 'No pudimos verificar la operación.');
    }

    const finalStatus = result.resultado;
    showMpResultState({
      code,
      status: finalStatus,
      message: result.mensaje || '',
      detail: result.detalle || ''
    });

    writeJsonStorage(ECIS_MP_ORDER_KEY, {
      codigo: code,
      orderId,
      paymentId: result.paymentId || info.paymentId || '',
      resultado: finalStatus,
      experienciaId: paymentDraft?.experienciaId || '',
      email: paymentDraft?.email || ''
    });

    if (finalStatus === 'aprobado') {
      writeJsonStorage(ECIS_RESULT_KEY, {
        codigo: code,
        experienciaId: paymentDraft?.experienciaId || '',
        email: paymentDraft?.email || '',
        medioPago: 'MercadoPago',
        resultado: 'aprobado',
        orderId
      });
      clearMpAttemptId();
    }

    if (finalStatus === 'rechazado') {
      clearMpAttemptId();
    }
  } catch (error) {
    showMpResultState({
      code,
      status: 'error',
      detail: error?.message || 'No pudimos verificar el pago en este momento.'
    });
  }
}

function initializePaymentPage() {
  if (!paymentSummary) return;

  paymentDraft = readJsonStorage(ECIS_STORAGE_KEY);
  const mpReturn = getMpReturnInfo();

  if (!paymentDraft || !paymentDraft.experienciaId) {
    if (mpReturn?.codigo) {
      showMpResultState({
        code: mpReturn.codigo,
        status: 'error',
        detail: 'Volviste desde Mercado Pago, pero esta pestaña ya no conserva los datos originales de la inscripción.'
      });
      verifyReturnedMercadoPagoPayment(mpReturn);
      return;
    }

    window.location.replace('inscripcion.html');
    return;
  }

  renderPaymentSummary(paymentDraft);
  if (paymentAmount) paymentAmount.textContent = formatArs(paymentDraft.importe);
  if (transferAmount) transferAmount.textContent = formatArs(paymentDraft.importe);
  if (mpCheckoutAmount) mpCheckoutAmount.textContent = formatArs(paymentDraft.importe);

  if (mpReturn) {
    if (mpReturn.codigo) reservedRegistrationCode = mpReturn.codigo;
    verifyReturnedMercadoPagoPayment(mpReturn);
    return;
  }

  const previousResult = readJsonStorage(ECIS_RESULT_KEY);
  if (
    previousResult?.codigo &&
    previousResult?.experienciaId === paymentDraft.experienciaId &&
    previousResult?.email === paymentDraft.email
  ) {
    if (previousResult.medioPago === 'MercadoPago' && previousResult.resultado === 'aprobado') {
      showMpResultState({ code: previousResult.codigo, status: 'aprobado' });
    } else {
      showFinishedState(previousResult.codigo, paymentDraft);
    }
    return;
  }

}

paymentMethodInputs.forEach(input => {
  input.addEventListener('change', () => {
    updatePaymentMethodSelection();
    if (transferCheckout) transferCheckout.hidden = true;
    if (mpCheckout) mpCheckout.hidden = true;
    setError(paymentError, '');
    setError(mpPaymentError, '');
  });
});

updatePaymentMethodSelection();

paymentProceed?.addEventListener('click', async () => {
  const selected = paymentMethodInputs.find(input => input.checked)?.value || 'Transferencia';

  if (selected === 'MercadoPago') {
    if (transferCheckout) transferCheckout.hidden = true;
    if (mpCheckout) mpCheckout.hidden = false;
    setError(mpPaymentError, '');

    if (mpCheckout) {
      mpCheckout.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center'
      });
    }

    try {
      const code = await ensureRegistrationCode();
      if (mpReservedCode) mpReservedCode.textContent = code;
    } catch (error) {
      if (mpReservedCode) mpReservedCode.textContent = 'No disponible';
      setError(mpPaymentError, error?.message || 'No pudimos generar el código de inscripción.');
    }
    return;
  }

  if (mpCheckout) mpCheckout.hidden = true;
  if (transferCheckout) {
    transferCheckout.hidden = false;
    transferCheckout.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
  }
});

mpRedirectButton?.addEventListener('click', async () => {
  if (!paymentDraft || !mpRedirectButton) return;

  setError(mpPaymentError, '');
  mpRedirectButton.disabled = true;
  mpRedirectButton.setAttribute('aria-busy', 'true');
  const originalText = mpRedirectButton.textContent;
  mpRedirectButton.textContent = 'Preparando Mercado Pago…';
  if (mpWaitMessage) mpWaitMessage.hidden = false;

  try {
    const codigo = await ensureRegistrationCode();
    const intentoId = getOrCreateMpAttemptId();

    const payload = {
      accion: 'mercadopago_checkout_pro',
      codigo,
      intentoId,
      nombre: paymentDraft.nombre,
      dni: paymentDraft.dni,
      email: paymentDraft.email,
      telefono: paymentDraft.telefono,
      institucion: paymentDraft.institucion || '',
      experienciaId: paymentDraft.experienciaId,
      returnUrl: getReturnBaseUrl()
    };

    const result = await submitCheckoutProThroughIframe(payload);

    writeJsonStorage(ECIS_MP_ORDER_KEY, {
      codigo,
      orderId: result.orderId || '',
      checkoutUrl: result.checkoutUrl,
      experienciaId: paymentDraft.experienciaId,
      email: paymentDraft.email,
      resultado: 'creado'
    });

    window.location.assign(result.checkoutUrl);
  } catch (error) {
    mpRedirectButton.disabled = false;
    mpRedirectButton.removeAttribute('aria-busy');
    mpRedirectButton.textContent = originalText;
    if (mpWaitMessage) mpWaitMessage.hidden = true;
    setError(mpPaymentError, error?.message || 'No pudimos abrir Mercado Pago. Intentá nuevamente.');
  }
});

mpRetryPayment?.addEventListener('click', () => {
  clearMpAttemptId();
  removeStorage(ECIS_RESULT_KEY);

  const cleanUrl = new URL(window.location.href);
  cleanUrl.search = '';
  cleanUrl.hash = '';
  window.history.replaceState({}, '', cleanUrl.href);

  if (mpResultPanel) mpResultPanel.hidden = true;
  if (paymentFlow) paymentFlow.hidden = false;
  if (finishedPanel) finishedPanel.hidden = true;

  paymentMethodInputs.forEach(input => {
    input.checked = input.value === 'MercadoPago';
  });
  updatePaymentMethodSelection();

  if (transferCheckout) transferCheckout.hidden = true;
  if (mpCheckout) {
    mpCheckout.hidden = false;
    mpCheckout.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }
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

async function copyCodeFromElement(element, button) {
  const code = element?.textContent?.trim();
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    const original = button?.textContent || 'Copiar código';
    if (button) button.textContent = 'Código copiado';
    window.setTimeout(() => {
      if (button) button.textContent = original;
    }, 1600);
  } catch (_) {
    window.prompt('Copiá tu código:', code);
  }
}

copyRegistrationCode?.addEventListener('click', () => copyCodeFromElement(finalRegistrationCode, copyRegistrationCode));
copyMpResultCode?.addEventListener('click', () => copyCodeFromElement(mpResultCode, copyMpResultCode));

transferDone?.addEventListener('click', async () => {
  if (!paymentDraft || !transferDone) return;
  setError(paymentError, '');

  const previous = readJsonStorage(ECIS_RESULT_KEY);
  if (previous?.codigo && previous?.experienciaId === paymentDraft.experienciaId && previous?.email === paymentDraft.email &&
      previous?.medioPago !== 'MercadoPago'
  ) {
    showFinishedState(previous.codigo, paymentDraft);
    return;
  }

  transferDone.disabled = true;
  transferDone.textContent = 'Generando código…';

  try {
    // Reservamos primero un código ECIS único.
    const codigo = await ensureRegistrationCode();

    const payload = {
      codigo,
      nombre: paymentDraft.nombre,
      dni: paymentDraft.dni,
      email: paymentDraft.email,
      telefono: paymentDraft.telefono,
      institucion: paymentDraft.institucion || '',
      experienciaId: paymentDraft.experienciaId,
      medioPago: 'Transferencia'
    };

    // Enviamos el registro a Apps Script sin esperar su respuesta.
    // Google Sheets puede tardar en responder aunque el registro ya se haya guardado.
    submitRegistrationThroughIframe(payload);

    const result = {
      codigo,
      experienciaId: paymentDraft.experienciaId,
      email: paymentDraft.email,
      medioPago: 'Transferencia',
      resultado: 'pendiente'
    };
    writeJsonStorage(ECIS_RESULT_KEY, result);

    // Avanzamos de inmediato: la transferencia queda pendiente de verificación manual.
    showFinishedState(codigo, paymentDraft);
  } catch (error) {
    transferDone.disabled = false;
    transferDone.removeAttribute('aria-busy');
    transferDone.textContent = 'Ya realicé la transferencia →';
    setError(paymentError, error?.message || 'No pudimos generar tu código de inscripción. Intentá nuevamente.');
  }
});

initializePaymentPage();
