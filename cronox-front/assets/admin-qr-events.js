(() => {
  'use strict';
  const root = document.getElementById('section-qr-events');
  if (!root) return;
  const $ = id => root.querySelector('#qrEvents' + id);
  const base = () => String(window.CRONOX_API?.API_BASE || '').replace(/\/$/, '');
  const number = value => new Intl.NumberFormat('es-ES').format(value);
  const dateFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const romans = ['', 'I', 'II', 'III', 'IV', 'V'];
  let groupId = '', group = null, generation = 0, readVersion = 0, readAbort;
  let groupPage = 1, participantPage = 1, creating = false, scanPending = null, retryRead = null;
  let cameraVersion = 0, cameraState = 'closed', stream = null, frameTimer, permissionTimer;
  let detector = null, reader = null, fallbackPromise;
  let resultTimer, resultVersion = 0, resultActive = false, exportPending = null;
  const heldCodes = new Map();
  const REMOVAL_MS = 800;
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const video = $('Video');
  const canvas = document.createElement('canvas');
  const current = (id, version) => groupId === id && generation === version && !root.hidden;
  const message = (id, value, state = 'info') => { $(id).textContent = value; $(id).dataset.state = state; };
  const node = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value ?? ''; if (className) el.className = className; return el; };

  async function request(path = '', method = 'GET', body, signal, format = 'json') {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 15000);
    try {
      const headers = { Accept: format === 'xlsx' ? XLSX_TYPE : 'application/json' };
      if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json' }, await window.CRONOX_API.getCsrfHeaders());
      if (controller.signal.aborted) throw new DOMException('Solicitud cancelada', 'AbortError');
      const response = await fetch(`${base()}/api/admin/qr-events${path}`, {
        method, headers, credentials: 'include', cache: 'no-store', signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error('No se pudo completar la operación.');
        error.status = response.status; error.code = data.code;
        throw error;
      }
      if (format === 'xlsx') {
        if (!(response.headers.get('content-type') || '').startsWith(XLSX_TYPE)) throw new Error('Archivo no confirmado');
        const filename = /filename="([a-zA-Z0-9._-]+\.xlsx)"/.exec(response.headers.get('content-disposition') || '')?.[1];
        const blob = await response.blob();
        if (!blob.size) throw new Error('Archivo vacío');
        return { blob, filename: filename || 'eventos-qr-ids.xlsx' };
      }
      return await response.json();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }

  function failure(error, scanning = false) {
    if (error.status === 401) return 'La sesión ha caducado. Inicia sesión de nuevo.';
    if (error.status === 403) return 'Permiso insuficiente para gestionar Eventos QR.';
    if (error.code === 'GROUP_UNAVAILABLE' || error.status === 404) return 'Grupo no disponible. Vuelve al listado y actualízalo.';
    if (error.code === 'CREDENTIAL_UNUSABLE') return 'Credencial no utilizable. Revisa el estado de la cuenta y su círculo.';
    if (error.code === 'INVALID_QR') return 'QR no válido o desconocido. Utiliza una acreditación CRONOX.';
    if (!scanning && error.status === 400) return 'Datos no válidos. Revisa el nombre y la descripción.';
    if (error.status === 429) return 'Demasiadas solicitudes. Espera unos segundos y vuelve a intentarlo.';
    return scanning
      ? 'No se pudo confirmar el registro por un fallo de red o servidor. Puede haberse guardado: reintenta el mismo QR para comprobarlo sin duplicarlo.'
      : 'No se pudo cargar la información por un fallo de red o servidor. Pulsa Actualizar para reintentar.';
  }

  function renderPages(prefix, data) {
    const page = Number(data.page) || 1, pages = Math.max(1, Number(data.pages) || Math.ceil(data.total / (data.limit || 25)));
    $(prefix + 'Page').textContent = `Página ${page} de ${pages} · ${number(data.total)} ${prefix ? 'participantes encontrados' : 'grupos'}`;
    $(prefix + 'Prev').disabled = page <= 1; $(prefix + 'Next').disabled = page >= pages;
  }

  function beginRead() {
    readAbort?.abort(); readAbort = new AbortController();
    return { version: ++readVersion, signal: readAbort.signal, scope: generation };
  }

  async function loadGroups() {
    const read = beginRead();
    message('Message', 'Cargando grupos…'); $('List').setAttribute('aria-busy', 'true');
    $('Prev').disabled = true; $('Next').disabled = true;
    try {
      const query = new URLSearchParams({ page: String(groupPage), limit: '25', q: $('Search').value.trim() });
      const data = await request('?' + query, 'GET', undefined, read.signal);
      if (generation !== read.scope || read.version !== readVersion || groupId) return;
      if (groupPage > 1 && !data.items.length) { groupPage = 1; return loadGroups(); }
      $('List').replaceChildren();
      for (const item of data.items) {
        const article = node('article', '', 'qr-events-group');
        article.append(node('h3', item.name), node('p', item.description || ''), node('strong', `${number(item.total)} participantes`));
        const open = node('button', 'Abrir grupo', 'btn'); open.type = 'button';
        open.setAttribute('aria-label', 'Abrir grupo: ' + item.name); open.onclick = () => navigate(String(item.id));
        article.append(open); $('List').append(article);
      }
      renderPages('', data); message('Message', data.items.length ? '' : 'No hay grupos con esta búsqueda.');
    } catch (error) {
      if (generation !== read.scope || read.version !== readVersion) return;
      $('List').replaceChildren(); $('Page').textContent = ''; message('Message', failure(error), 'error');
    } finally { if (read.version === readVersion) $('List').setAttribute('aria-busy', 'false'); }
  }

  function updateGroup(value) {
    group = value;
    $('GroupName').textContent = group.name;
    $('GroupDescription').textContent = group.description || '';
    $('Total').textContent = `${number(group.total)} participantes`;
    $('CameraOpen').disabled = cameraState !== 'closed';
    updateExport();
  }

  function updateExport() {
    $('Export').disabled = !group || !group.total || !!exportPending;
    if (group && !group.total && !exportPending) message('ExportMessage', 'No hay participantes para descargar.');
    else if ($('ExportMessage').textContent === 'No hay participantes para descargar.') message('ExportMessage', '');
  }

  function cancelExport() {
    exportPending?.controller.abort(); exportPending = null;
    $('Export').textContent = 'Descargar IDs en Excel'; $('Export').removeAttribute('aria-busy');
    $('Export').disabled = true; message('ExportMessage', '');
  }

  async function downloadIds() {
    if (!group?.total || exportPending || root.hidden) return;
    const pending = { id: groupId, scope: generation, controller: new AbortController() };
    exportPending = pending; updateExport();
    $('Export').textContent = 'Preparando Excel…'; $('Export').setAttribute('aria-busy', 'true');
    message('ExportMessage', 'Preparando todos los IDs del grupo…');
    try {
      const result = await request(`/${encodeURIComponent(pending.id)}/ids.xlsx`, 'GET', undefined, pending.controller.signal, 'xlsx');
      if (exportPending !== pending || !current(pending.id, pending.scope)) return;
      const url = URL.createObjectURL(result.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = result.filename;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('ExportMessage', 'Excel descargado con todos los IDs del grupo.', 'success');
    } catch (error) {
      if (exportPending !== pending || !current(pending.id, pending.scope)) return;
      if (error.code === 'EMPTY_GROUP') { group.total = 0; $('Total').textContent = '0 participantes'; }
      message('ExportMessage', error.code === 'UNRESOLVED_PARTICIPANT_ID'
        ? 'Hay registros sin un usuario asociado. No se ha generado un Excel incompleto: revisa esos registros.'
        : error.code === 'EMPTY_GROUP' ? 'No hay participantes para descargar.'
        : [401, 403, 404].includes(error.status) ? failure(error)
        : 'No se pudo descargar el Excel. Vuelve a pulsar Descargar IDs en Excel para reintentarlo.', 'error');
    } finally {
      if (exportPending === pending) {
        exportPending = null; $('Export').textContent = 'Descargar IDs en Excel';
        $('Export').removeAttribute('aria-busy'); updateExport();
      }
    }
  }

  function renderParticipant(item) {
    const row = document.createElement('tr'); row.dataset.participantId = String(item.id);
    const date = new Date(item.registeredAt);
    const registeredBy = item.registeredBy ? (item.registeredBy.name || String(item.registeredBy.id ?? 'ID no disponible')) : 'Cuenta eliminada';
    const userId = Number.isSafeInteger(item.userId) ? String(item.userId) : 'ID no disponible';
    row.append(node('td', userId, 'qr-events-id'), node('td', item.deleted ? 'Cuenta eliminada' : item.name || ''),
      node('td', romans[item.circleAtRegistration] || 'No disponible'), node('td', Number.isFinite(date.getTime()) ? dateFormat.format(date) : ''),
      node('td', registeredBy), node('td', item.qrIdentifier || 'No disponible', 'qr-events-qr'));
    return row;
  }

  async function loadParticipants() {
    const id = groupId, read = beginRead();
    message('ParticipantMessage', 'Cargando participantes…'); $('Participants').setAttribute('aria-busy', 'true');
    $('ParticipantPrev').disabled = true; $('ParticipantNext').disabled = true;
    try {
      const query = new URLSearchParams({ page: String(participantPage), limit: '25', q: $('ParticipantSearch').value.trim() });
      const data = await request(`/${encodeURIComponent(id)}/participants?${query}`, 'GET', undefined, read.signal);
      if (!current(id, read.scope) || read.version !== readVersion) return;
      if (participantPage > 1 && !data.items.length) { participantPage = 1; return loadParticipants(); }
      updateGroup(data.group); $('Participants').replaceChildren(...data.items.map(renderParticipant));
      renderPages('Participant', data); message('ParticipantMessage', data.items.length ? '' : 'No hay participantes con esta búsqueda.');
    } catch (error) {
      if (!current(id, read.scope) || read.version !== readVersion) return;
      $('Participants').replaceChildren(); $('ParticipantPage').textContent = ''; message('ParticipantMessage', failure(error), 'error');
      if ([401, 403, 404].includes(error.status)) { group = null; stopCamera(); $('CameraOpen').disabled = true; updateExport(); }
    } finally { if (read.version === readVersion) $('Participants').setAttribute('aria-busy', 'false'); }
  }

  function resetView(id) {
    generation++; readVersion++; readAbort?.abort(); stopCamera(); cancelExport();
    groupId = id; group = null; participantPage = 1;
    $('ScanRetry').hidden = true; message('ScanMessage', ''); $('ParticipantSearch').value = '';
    $('Participants').replaceChildren(); $('GroupName').textContent = 'Cargando grupo…';
    root.querySelector('.qr-events-table-wrap').scrollLeft = 0;
    $('GroupDescription').textContent = ''; $('Total').textContent = ''; $('CameraOpen').disabled = true;
    $('Overview').hidden = !!id; $('Detail').hidden = !id;
  }

  function navigate(id) {
    // Stop synchronously, before hash navigation or a late decode can race it.
    resetView(id);
    const target = '#section-qr-events' + (id ? '?group=' + encodeURIComponent(id) : '');
    if (location.hash === target) void load(); else location.hash = target;
  }

  function load() {
    const id = new URLSearchParams(location.hash.split('?')[1] || '').get('group') || '';
    if (id !== groupId) resetView(id);
    return id ? loadParticipants() : loadGroups();
  }

  function clearResult() {
    resultVersion++; clearTimeout(resultTimer); resultActive = false;
    $('ScanResult').hidden = true; $('ScanResultText').textContent = '';
    delete $('ScanResult').dataset.result;
  }

  function showResult(kind) {
    clearResult();
    const text = { registered: 'aprobado', already_registered: 'ya registrado', invalid: 'no válido' }[kind];
    // Start the hold only now: after the server has confirmed, not when reading.
    resultActive = true; $('ScanResult').dataset.result = kind;
    $('ScanResultText').textContent = text; $('ScanResult').hidden = false;
    const version = resultVersion, camera = cameraVersion, id = groupId, scope = generation;
    resultTimer = setTimeout(() => {
      if (version !== resultVersion || camera !== cameraVersion || !current(id, scope)) return;
      clearResult();
    }, kind === 'registered' ? 1000 : 2000);
  }

  function observeCodes(values) {
    const now = performance.now();
    // Keep observing while requests/results block registration. A held QR is
    // rearmed by its absence across frames, never by an elapsed success timer.
    for (const [value, lastSeen] of heldCodes) {
      if (values.includes(value)) heldCodes.set(value, now);
      else if (now - lastSeen >= REMOVAL_MS) heldCodes.delete(value);
    }
    if (scanPending || resultActive || retryRead) return;
    const next = values.find(value => !heldCodes.has(value));
    if (next !== undefined) void submitRead(next);
  }

  async function submitRead(raw, retry = false) {
    if (!group || root.hidden || scanPending || resultActive || cameraState !== 'open') return;
    const qrContent = String(raw), id = groupId, scope = generation, camera = cameraVersion;
    if (!retry && (retryRead || heldCodes.has(qrContent))) return;
    heldCodes.set(qrContent, performance.now());
    if (!qrContent || qrContent.length > 512) {
      message('ScanMessage', 'QR no válido o desconocido. Utiliza una acreditación CRONOX.', 'error'); showResult('invalid'); return;
    }
    // Scope includes the camera session: stopping also invalidates late writes.
    const pending = { id, scope, camera, qrContent, controller: new AbortController() }; scanPending = pending;
    const active = () => current(id, scope) && camera === cameraVersion && scanPending === pending;
    retryRead = null; $('ScanRetry').hidden = true; message('ScanMessage', 'Comprobando y guardando acreditación…');
    try {
      const result = await request(`/${encodeURIComponent(id)}/scan`, 'POST', { qrContent }, pending.controller.signal);
      if (!active()) return;
      if (String(result.groupId) !== id || !['registered', 'already_registered'].includes(result.status)
          || !result.participant?.id || !Number.isSafeInteger(result.participant.userId)
          || !Number.isSafeInteger(result.total) || result.total < 1) throw new Error('Respuesta no confirmada');
      const duplicate = result.status === 'already_registered';
      showResult(result.status);
      message('CameraMessage', 'Cámara abierta. Enfoca el QR completo de la acreditación.');
      message('ScanMessage', (duplicate ? 'Ya registrado en este grupo' : 'Registrado') + (result.participant.name ? ': ' + result.participant.name : '.') + (cameraState === 'open' ? ' Puedes escanear la siguiente acreditación.' : ''), duplicate ? 'warning' : 'success');
      group.total = result.total; $('Total').textContent = `${number(result.total)} participantes`;
      updateExport();
      // Invalidate any older list response before showing the confirmed row/count.
      readVersion++; readAbort?.abort();
      if (participantPage === 1 && !$('ParticipantSearch').value.trim()) {
        const existing = [...$('Participants').children].find(row => row.dataset.participantId === String(result.participant.id));
        if (existing) existing.replaceWith(renderParticipant(result.participant));
        else $('Participants').prepend(renderParticipant(result.participant));
      }
      void loadParticipants();
    } catch (error) {
      if (!active()) return;
      message('ScanMessage', failure(error, true), 'error');
      if ([400, 422].includes(error.status) && ['INVALID_QR', 'CREDENTIAL_UNUSABLE'].includes(error.code)) {
        showResult('invalid');
      } else if ([401, 403, 404].includes(error.status)) {
        stopCamera(); group = null; $('CameraOpen').disabled = true; updateExport();
      } else {
        // Unknown, permission-independent and transport failures are technical,
        // never red invalid-credential results or unconfirmed approvals.
        retryRead = pending; $('ScanRetry').hidden = false;
        message('CameraMessage', 'Cámara abierta. Lecturas en pausa: reintenta el último registro para continuar.');
      }
    } finally { if (scanPending === pending) scanPending = null; }
  }

  function stopTracks(value) { value?.getTracks().forEach(track => track.stop()); }

  function stopCamera(text = 'Cámara cerrada.') {
    cameraVersion++; clearTimeout(frameTimer); clearTimeout(permissionTimer);
    clearResult(); heldCodes.clear(); scanPending?.controller.abort();
    retryRead = null; $('ScanRetry').hidden = true;
    stopTracks(stream); stream = null; video.srcObject = null;
    canvas.width = 0; canvas.height = 0;
    try { video.pause(); } catch (_) { /* Media element may already be detached. */ }
    cameraState = 'closed'; detector = null; reader = null;
    $('Scanner').hidden = true; $('CameraStop').disabled = true; $('CameraOpen').disabled = !group;
    $('CameraLabel').hidden = true; message('CameraMessage', text);
  }

  async function loadFallback() {
    if (window.CRONOX_QR_READER?.createReader) return window.CRONOX_QR_READER;
    if (!fallbackPromise) fallbackPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'assets/qr-reader.js?v=1'; script.async = true;
      const timeout = setTimeout(() => { script.remove(); reject(new Error('No se pudo cargar el lector local.')); }, 15000);
      script.onload = () => { clearTimeout(timeout); window.CRONOX_QR_READER?.createReader ? resolve(window.CRONOX_QR_READER) : reject(new Error('Lector no disponible.')); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('No se pudo cargar el lector local.')); };
      document.head.append(script);
    }).catch(error => { fallbackPromise = null; throw error; });
    return fallbackPromise;
  }

  async function prepareDecoder() {
    if (window.BarcodeDetector && typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) return { detector: new window.BarcodeDetector({ formats: ['qr_code'] }) };
      } catch (_) { /* Capability detection may reject despite an exposed class. */ }
    }
    const library = await loadFallback();
    return { reader: await library.createReader() };
  }

  async function decodeFrame(version, id, scope) {
    if (version !== cameraVersion || !current(id, scope) || cameraState !== 'open') return;
    if (video.readyState >= 2) {
      try {
        let values;
        if (detector) {
          try { values = (await detector.detect(video)).map(code => code.rawValue).filter(value => typeof value === 'string'); }
          catch (_) {
            const library = await loadFallback();
            if (version !== cameraVersion || !current(id, scope)) return;
            const fallbackReader = await library.createReader();
            if (version !== cameraVersion || !current(id, scope)) return;
            detector = null; reader = fallbackReader;
          }
        } else if (reader) {
          const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
          if (canvas.width && canvas.height) {
            canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
            const value = await reader.decodeFromCanvas(canvas);
            values = typeof value === 'string' ? [value] : [];
          }
        }
        if (values && version === cameraVersion && current(id, scope)) observeCodes(values);
      } catch (error) {
        if (version === cameraVersion) stopCamera('No se pudo leer la cámara. Detén y vuelve a abrir el lector.');
      }
    }
    if (version === cameraVersion && current(id, scope) && cameraState === 'open') frameTimer = setTimeout(() => void decodeFrame(version, id, scope), 160);
  }

  function cameraFailure(error) {
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name)) return 'Permiso de cámara denegado. Permítelo en los ajustes del navegador y pulsa Abrir cámara.';
    if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error.name)) return 'No se encontró esa cámara. Conecta o selecciona otra cámara y vuelve a abrirla.';
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error.name)) return 'Cámara ocupada o no disponible. Ciérrala en otras aplicaciones y vuelve a intentarlo.';
    return 'No se pudo abrir el lector. Comprueba la cámara y la conexión, y pulsa Abrir cámara para reintentar.';
  }

  async function listCameras(version) {
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (version !== cameraVersion) return;
      $('CameraChoice').replaceChildren(...devices.map((device, index) => {
        const option = node('option', device.label || 'Cámara ' + (index + 1)); option.value = device.deviceId; return option;
      }));
      const activeDevice = stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
      if (activeDevice) $('CameraChoice').value = activeDevice;
      $('CameraLabel').hidden = devices.length < 2;
    } catch (_) { /* The active camera still works if device enumeration is restricted. */ }
  }

  async function openCamera(deviceId) {
    if (!group || root.hidden) return;
    stopCamera();
    if (!window.isSecureContext) { message('CameraMessage', 'La cámara requiere HTTPS o localhost. Abre el administrador en un contexto seguro.', 'error'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { message('CameraMessage', 'Este navegador no ofrece acceso a una cámara. Utiliza un navegador compatible y comprueba que haya una cámara conectada.', 'error'); return; }
    const version = cameraVersion, id = groupId, scope = generation;
    cameraState = 'pending'; $('CameraOpen').disabled = true; $('CameraStop').disabled = false;
    message('CameraMessage', 'Permiso de cámara pendiente. Puedes detener el intento mientras respondes al navegador.');
    // getUserMedia cannot be aborted. Every late stream is stopped before attachment.
    permissionTimer = setTimeout(() => {
      if (version === cameraVersion && cameraState === 'pending') stopCamera('El permiso de cámara sigue pendiente. Puedes volver a abrirla cuando hayas revisado el permiso.');
    }, 30000);
    let acquired;
    try {
      const decoder = await prepareDecoder();
      if (version !== cameraVersion || !current(id, scope)) return;
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (version !== cameraVersion || !current(id, scope)) { stopTracks(acquired); return; }
      stream = acquired; detector = decoder.detector || null; reader = decoder.reader || null;
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      $('Scanner').hidden = false; await video.play();
      if (version !== cameraVersion || !current(id, scope)) { stopTracks(acquired); return; }
      clearTimeout(permissionTimer); cameraState = 'open';
      message('CameraMessage', 'Cámara abierta. Enfoca el QR completo de la acreditación.');
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (version === cameraVersion) stopCamera('La cámara se ha desconectado. Puedes volver a abrirla.'); }, { once: true }));
      void listCameras(version); void decodeFrame(version, id, scope);
    } catch (error) {
      stopTracks(acquired);
      if (version !== cameraVersion || !current(id, scope)) return;
      stopCamera(); message('CameraMessage', cameraFailure(error), 'error');
    }
  }

  function leave() {
    generation++; readVersion++; readAbort?.abort(); stopCamera(); cancelExport();
    group = null; groupId = '';
    $('Participants').replaceChildren(); $('List').replaceChildren();
    $('GroupName').textContent = ''; $('GroupDescription').textContent = ''; $('Total').textContent = '';
    message('ScanMessage', '');
    $('ScanRetry').hidden = true; $('Overview').hidden = false; $('Detail').hidden = true;
  }

  $('Create').addEventListener('submit', async event => {
    event.preventDefault(); if (creating) return;
    const name = $('Create').elements.name.value.trim(), description = $('Create').elements.description.value.trim();
    if (!name) { message('CreateMessage', 'El nombre del grupo es obligatorio.', 'error'); return; }
    creating = true; const button = $('Create').querySelector('button'); button.disabled = true;
    const scope = generation; message('CreateMessage', 'Guardando grupo…');
    try {
      const created = await request('', 'POST', { name, description: description || undefined });
      $('Create').reset(); window.CRONOX_ADMIN_SHELL?.clear($('Create'));
      if (scope !== generation || root.hidden) return;
      message('CreateMessage', 'Grupo creado.', 'success'); navigate(String(created.id));
    } catch (error) {
      if (scope === generation) message('CreateMessage', !error.status || error.status >= 500 ? 'No se pudo confirmar la creación. Actualiza el listado antes de volver a crear el grupo; puede haberse guardado.' : failure(error), 'error');
    } finally { creating = false; button.disabled = false; }
  });
  $('Filters').addEventListener('submit', event => { event.preventDefault(); groupPage = 1; void loadGroups(); });
  $('Refresh').onclick = () => void loadGroups();
  $('Prev').onclick = () => { groupPage--; void loadGroups(); }; $('Next').onclick = () => { groupPage++; void loadGroups(); };
  $('Back').onclick = () => navigate('');
  $('ParticipantFilters').addEventListener('submit', event => { event.preventDefault(); participantPage = 1; void loadParticipants(); });
  $('ParticipantsRefresh').onclick = () => void loadParticipants();
  $('Export').onclick = () => void downloadIds();
  $('ParticipantPrev').onclick = () => { participantPage--; void loadParticipants(); }; $('ParticipantNext').onclick = () => { participantPage++; void loadParticipants(); };
  $('CameraOpen').onclick = () => void openCamera(); $('CameraStop').onclick = () => stopCamera();
  $('CameraChoice').onchange = () => void openCamera($('CameraChoice').value);
  $('ScanRetry').onclick = () => { if (retryRead && current(retryRead.id, retryRead.scope)) void submitRead(retryRead.qrContent, true); };
  window.addEventListener('pagehide', leave);
  window.addEventListener('cronox:session-ended', leave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera('Cámara detenida al dejar de ver la página. Pulsa Abrir cámara para continuar.'); });
  new MutationObserver(() => { if (root.hidden) leave(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  window.CRONOX_QR_EVENTS = Object.freeze({ load, leave });
  // Auth may finish before this deferred module is evaluated on a direct route.
  queueMicrotask(() => { if (!root.hidden && readVersion === 0) void load(); });
})();
