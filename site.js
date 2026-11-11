// ECIS 132.0 — núcleo liviano para páginas estáticas
// Navegación, contacto y movimiento editorial esencial.

document.querySelectorAll('#year').forEach(el => {
  el.textContent = new Date().getFullYear();
});

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function sanitizePersonName(value) {
  return String(value || '')
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿĀ-ž'’\- ]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/[’']{2,}/g, "'");
}

function isValidPersonName(value) {
  const clean = String(value || '').trim();
  return /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:[ '’\-][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*$/.test(clean);
}

function bindContactNameGuard() {
  const input = document.querySelector('#nombre');
  if (!input) return;
  const apply = () => {
    const caret = input.selectionStart;
    const before = input.value.length;
    const sanitized = sanitizePersonName(input.value);
    if (sanitized !== input.value) {
      input.value = sanitized;
      if (typeof caret === 'number') {
        const next = Math.max(0, caret - (before - sanitized.length));
        try { input.setSelectionRange(next, next); } catch (_) {}
      }
    }
    input.setCustomValidity(
      input.value && !(isValidPersonName(input.value) && input.value.trim().length >= 3)
        ? 'Usá letras; podés incluir espacios, apóstrofes y guiones.'
        : ''
    );
  };
  input.addEventListener('input', apply);
  input.addEventListener('blur', apply);
  apply();
}

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

const currentFile = (window.location.pathname.split('/').pop() || 'index.html').split('?')[0];
nav?.querySelectorAll('a[href]').forEach(link => {
  if (link.getAttribute('href') === currentFile) link.setAttribute('aria-current', 'page');
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav?.classList.contains('is-open')) {
    closeMobileNav({ focusToggle: true });
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 1100 && nav?.classList.contains('is-open')) closeMobileNav();
}, { passive: true });

const contactForm = document.querySelector('.contact-form[data-formsubmit-ajax]');
const formStatus = document.querySelector('#form-status');
const contactFormUrl = document.querySelector('#contact-form-url');
const contactFormNext = document.querySelector('#contact-form-next');

if (contactForm) {
  const cleanUrl = `${location.origin}${location.pathname}`;
  if (contactFormUrl) contactFormUrl.value = cleanUrl;
  if (contactFormNext) contactFormNext.value = `${cleanUrl}?enviado=1`;
  const params = new URLSearchParams(location.search);
  if (params.get('enviado') === '1' && formStatus) {
    formStatus.textContent = 'Gracias por comunicarte con ECIS. Recibimos tu consulta y te responderemos a la brevedad.';
    formStatus.hidden = false;
  }
}

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

  const controller = 'AbortController' in window ? new AbortController() : null;
  const timeout = window.setTimeout(() => controller?.abort(), 12000);
  try {
    const payload = Object.fromEntries(new FormData(contactForm).entries());
    const response = await fetch(contactForm.dataset.formsubmitAjax, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller?.signal
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.success === false || String(data.success).toLowerCase() === 'false') {
      throw new Error(data.message || 'No se pudo enviar el mensaje.');
    }
    contactForm.reset();
    if (formStatus) {
      formStatus.textContent = 'Gracias por comunicarte con ECIS. Recibimos tu consulta y te responderemos a la brevedad.';
      formStatus.hidden = false;
      formStatus.focus({ preventScroll: true });
    }
  } catch (error) {
    // Si el canal AJAX se corta (timeout, CORS o conectividad), usamos el POST
    // HTML estándar de FormSubmit. Es menos elegante porque navega, pero evita
    // que una consulta válida se pierda por un problema del navegador.
    const networkLike = error?.name === 'AbortError' || navigator.onLine === false || error instanceof TypeError;
    if (networkLike && navigator.onLine !== false) {
      if (submitButton) submitButton.textContent = 'Enviando por canal alternativo…';
      window.setTimeout(() => HTMLFormElement.prototype.submit.call(contactForm), 50);
      return;
    }
    if (formStatus) {
      formStatus.textContent = 'No pudimos enviar el mensaje en este momento. Podés reintentar o usar correo electrónico o WhatsApp.';
      formStatus.classList.add('is-error');
      formStatus.hidden = false;
      formStatus.focus({ preventScroll: true });
    }
  } finally {
    window.clearTimeout(timeout);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
});

function initializeEditorialMotion() {
  document.body.classList.add('is-ready');
  const header = document.querySelector('.site-header');
  const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 26);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  if (prefersReducedMotion()) return;
  const targets = Array.from(document.querySelectorAll(
    '.reveal,.value-item,.source-reference-card,.contact-row,.experience-card,.profile-editorial,.admin-band,.philosophy-grid,.institution-band-grid,.formats-heading,.home-experience-inner,.page-banner-content,.contact-form-wrap'
  ));
  targets.forEach((element,index) => {
    element.classList.add('lux-reveal');
    element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 55}ms`);
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -2% 0px' });
    targets.forEach(el => observer.observe(el));
  } else {
    targets.forEach(el => el.classList.add('is-revealed'));
  }
}

bindContactNameGuard();
initializeEditorialMotion();
