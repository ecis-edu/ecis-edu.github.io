// ECIS 132.0 — Gestiones legales robustas y reintento idempotente
(() => {
  'use strict';
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbwm5voUlP5k02F-bNalKUkUknY2SvKe6PVpgOivqn8z0zKPKHNzGmII0UNxJLfljTkp/exec';
  const VERSION_CONDICIONES = '2026-11-05-v5';
  const VERSION_POLITICA_BAJA = '2026-11-05-baja-v2';
  const VERSION_INFO_ARREPENTIMIENTO = '2026-11-05-arrep-v2';

  const form = document.querySelector('#ecis-management-form');
  const postForm = document.querySelector('#ecis-management-post');
  const payloadInput = document.querySelector('#ecis-management-payload');
  const frame = document.querySelector('#ecis-management-frame');
  const typeSelect = document.querySelector('#management-type');
  const submit = document.querySelector('#management-submit');
  const errorBox = document.querySelector('#management-error');
  const success = document.querySelector('#management-success');
  const resultCode = document.querySelector('#management-result-code');
  const copyCode = document.querySelector('#management-copy-code');
  const emailStatus = document.querySelector('#management-email-status');
  const title = document.querySelector('#management-form-title');
  const help = document.querySelector('#management-form-help');
  const explainer = document.querySelector('#management-type-explainer');
  const refundNotice = document.querySelector('#management-refund-notice');
  const successTitle = document.querySelector('#management-success-title');
  const successNote = document.querySelector('#management-success-note');
  if (!form || !postForm || !payloadInput || !frame || !typeSelect || !submit) return;

  const typeCopy = {
    arrepentimiento: {
      title: 'Dejar sin efecto una contratación reciente',
      help: 'Si contrataste online hace poco y querés dejar sin efecto la contratación, usá esta opción.',
      explainer: '<strong>Arrepentimiento</strong><p>El plazo legal general es de 10 días desde la contratación. Si corresponde, se reintegra el 100% de lo abonado. No necesitás explicar el motivo. Si la actividad ya fue utilizada o consumida, pueden aplicarse excepciones legales.</p>',
      button: 'Solicitar arrepentimiento →',
      successTitle: 'Tu solicitud de arrepentimiento quedó registrada.',
      successNote: 'ECIS verificará que el pedido esté dentro del plazo legal. Si corresponde, se reintegrará el 100% de lo abonado y te avisaremos por correo.',
      policyVersion: VERSION_INFO_ARREPENTIMIENTO
    },
    baja: {
      title: 'Solicitar la baja del servicio',
      help: 'Usá esta opción si ya no vas a participar y querés dar de baja la actividad contratada.',
      explainer: '<strong>Baja de servicio</strong><p>Si pedís la baja con 24 horas o más de anticipación, se reintegra el 100%. Con menos de 24 horas de anticipación, no hay reintegro. El derecho legal de arrepentimiento se mantiene cuando corresponda.</p>',
      button: 'Solicitar baja →',
      successTitle: 'Tu solicitud de baja quedó registrada.',
      successNote: 'ECIS verificará la fecha de la solicitud. Con 24 horas o más de anticipación corresponde reintegro del 100%; con menos de 24 horas, no hay reintegro, salvo que corresponda el derecho legal de arrepentimiento.',
      policyVersion: VERSION_POLITICA_BAJA
    }
  };

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 3 | 8); return v.toString(16);
    });
  }

  function selectedCopy() { return typeCopy[typeSelect.value] || null; }

  function updateType(value) {
    const item = typeCopy[value] || null;
    if (title) title.textContent = item ? item.title : 'Elegí qué querés solicitar';
    if (help) help.textContent = item ? item.help : 'Ambos trámites se realizan desde este mismo formulario.';
    if (explainer) {
      explainer.hidden = !item;
      explainer.innerHTML = item ? item.explainer : '';
    }
    if (refundNotice) refundNotice.hidden = value !== 'baja';
    submit.textContent = item ? item.button : 'Enviar solicitud →';
  }

  const requested = new URLSearchParams(location.search).get('tipo') || '';
  const normalized = ['arrepentimiento','baja'].includes(requested) ? requested : '';
  if (normalized) typeSelect.value = normalized;
  updateType(normalized);
  typeSelect.addEventListener('change', () => updateType(typeSelect.value || ''));

  let pendingId = '';
  let timer = null;
  function setError(msg) { errorBox.textContent = msg || ''; errorBox.hidden = !msg; }

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.source !== 'ecis-management') return;
    if (pendingId && data.solicitudId && data.solicitudId !== pendingId) return;
    if (timer) clearTimeout(timer);
    submit.disabled = false;
    const copy = typeCopy[data.tipo === 'Arrepentimiento' ? 'arrepentimiento' : data.tipo === 'Baja de servicio' ? 'baja' : typeSelect.value] || selectedCopy();
    if (data.resultado !== 'ok' || !data.codigoGestion) {
      updateType(typeSelect.value || '');
      setError(data.mensaje || 'No pudimos registrar la solicitud. Intentá nuevamente o escribinos por correo.');
      return;
    }
    setError('');
    form.hidden = true;
    if (resultCode) resultCode.textContent = data.codigoGestion;
    if (successTitle && copy) successTitle.textContent = copy.successTitle;
    if (successNote && copy) successNote.textContent = copy.successNote;
    if (emailStatus && data.emailEnviado === false) emailStatus.textContent = 'Guardá este código. La solicitud quedó registrada, pero no pudimos enviar la constancia por correo; ECIS podrá identificarla con este número.';
    success.hidden = false;
    success.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    window.ecisTrack?.('management_request_created', { management_type: data.tipo || typeSelect.value || 'sin_tipo' });
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    setError('');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const copy = selectedCopy();
    if (!copy) { setError('Elegí qué trámite querés realizar.'); return; }
    if (navigator.onLine === false) { setError('No hay conexión a internet. Cuando vuelva, enviá la solicitud nuevamente.'); return; }
    if (!pendingId) pendingId = uuid();
    const data = Object.fromEntries(new FormData(form).entries());
    data.accion = 'crear_gestion';
    data.solicitudId = pendingId;
    data.origen = location.pathname + location.search;
    data.versionCondiciones = VERSION_CONDICIONES;
    data.politicaInformada = copy.policyVersion;
    payloadInput.value = JSON.stringify(data);
    postForm.action = ENDPOINT;
    submit.disabled = true;
    submit.textContent = 'Registrando solicitud…';
    postForm.submit();
    timer = setTimeout(() => {
      submit.disabled = false;
      updateType(typeSelect.value || '');
      setError('La respuesta está demorando. No envíes varias veces la misma solicitud: verificá tu correo y, si no recibís la constancia, intentá nuevamente en unos minutos.');
    }, 20000);
  });

  copyCode?.addEventListener('click', async () => {
    const code = resultCode?.textContent?.trim();
    if (!code) return;
    try { await navigator.clipboard.writeText(code); copyCode.textContent = 'Código copiado'; setTimeout(() => copyCode.textContent = 'Copiar código', 1600); }
    catch (_) { window.prompt('Copiá tu código de gestión:', code); }
  });
})();
