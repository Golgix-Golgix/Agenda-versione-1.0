
const $ = (id) => document.getElementById(id);
const cfg = window.AGENDA_CONFIG || {};
const hasSupabaseConfig = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.supabaseUrl || '') && !!cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes('INSERISCI');
let supabase = null;
if (hasSupabaseConfig) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
}
const STORAGE_KEY = 'agenda-appointments-v1';
const ADMIN_AUDIT_KEY = 'agenda-admin-audit-demo-v1';
const ADMIN_DEMO_USERS = [
  { id: 'demo-mario', name: 'Mario Rossi', email: 'mario.demo@example.test', status: 'Attivo' },
  { id: 'demo-laura', name: 'Laura Bianchi', email: 'laura.demo@example.test', status: 'Attivo' },
  { id: 'demo-luca', name: 'Luca Verdi', email: 'luca.demo@example.test', status: 'Sospeso' }
];
const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const shortMonths = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const state = {
  currentDate: new Date(),
  selectedDate: toISODate(new Date()),
  appointments: [],
  user: null,
  search: '',
  authMode: 'login',
  demo: !supabase,
  busy: false,
  adminDemoViewing: null
};

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function parseDate(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function buildWazeUrl(location) {
  const url = new URL('https://waze.com/ul');
  url.searchParams.set('q', String(location || '').trim());
  url.searchParams.set('navigate', 'yes');
  return url.toString();
}
function currentStorageKey() {
  return state.adminDemoViewing ? `${STORAGE_KEY}-${state.adminDemoViewing.id}` : STORAGE_KEY;
}
function getLocalAppointments(key = currentStorageKey()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
function saveLocalAppointments() {
  localStorage.setItem(currentStorageKey(), JSON.stringify(state.appointments));
}
function getAdminAudit() {
  try { const value = JSON.parse(localStorage.getItem(ADMIN_AUDIT_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; }
}
function logAdminAction(action, user, details = '') {
  if (!state.adminDemoViewing) return;
  const log = getAdminAudit();
  log.unshift({ action, user: user?.name || state.adminDemoViewing.name, details, at: new Date().toISOString() });
  localStorage.setItem(ADMIN_AUDIT_KEY, JSON.stringify(log.slice(0, 100)));
}
function demoUserAppointments(userId) {
  try { const value = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-${userId}`) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; }
}
function openAdminDemo() {
  if (supabase) { showToast('La demo amministratore è disattivata quando è collegato un account reale.'); return; }
  closeModal('accountModal');
  renderAdminPanel();
  openModal('adminModal');
}
function renderAdminPanel() {
  const users = $('adminUserList');
  users.innerHTML = '';
  ADMIN_DEMO_USERS.forEach((user) => {
    const card = document.createElement('div');
    card.className = 'admin-user-card';
    const info = document.createElement('div');
    info.className = 'admin-user-info';
    const name = document.createElement('strong'); name.textContent = user.name;
    const email = document.createElement('span'); email.textContent = user.email;
    const status = document.createElement('small'); status.textContent = user.status;
    info.append(name, email, status);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Apri agenda';
    button.addEventListener('click', () => openDemoUserAgenda(user.id));
    card.append(info, button); users.appendChild(card);
  });
  const auditHolder = $('adminAuditList');
  const log = getAdminAudit(); auditHolder.innerHTML = '';
  if (!log.length) { auditHolder.innerHTML = '<p class="admin-audit-empty">Non ci sono ancora operazioni registrate.</p>'; return; }
  log.slice(0, 12).forEach((entry) => {
    const row = document.createElement('div'); row.className = 'admin-audit-row';
    const action = document.createElement('strong'); action.textContent = entry.action;
    const detail = document.createElement('span'); detail.textContent = `${entry.user}${entry.details ? ` · ${entry.details}` : ''}`;
    const time = document.createElement('small'); time.textContent = new Date(entry.at).toLocaleString('it-IT');
    row.append(action, detail, time); auditHolder.appendChild(row);
  });
}
function openDemoUserAgenda(userId) {
  const user = ADMIN_DEMO_USERS.find((item) => item.id === userId);
  if (!user) return;
  saveLocalAppointments();
  state.adminDemoViewing = user;
  state.appointments = demoUserAppointments(userId);
  state.selectedDate = toISODate(new Date());
  state.currentDate = new Date();
  logAdminAction('Apertura agenda utente', user, 'Consultazione amministrativa demo');
  closeModal('adminModal');
  $('adminViewedUserName').textContent = user.name;
  $('adminViewBanner').classList.remove('hidden');
  renderAll();
  showToast(`Stai visualizzando l’agenda demo di ${user.name}.`);
}
function exitAdminDemoView() {
  if (!state.adminDemoViewing) return;
  saveLocalAppointments();
  const previous = state.adminDemoViewing;
  logAdminAction('Uscita dalla vista utente', previous);
  state.adminDemoViewing = null;
  state.appointments = getLocalAppointments();
  $('adminViewBanner').classList.add('hidden');
  renderAll();
  showToast('Sei tornato alla tua agenda locale.');
}
function normalizeRow(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || '',
    location: row.location || '',
    event_date: row.event_date,
    event_time: String(row.event_time || '09:00').slice(0,5),
    reminder_enabled: !!row.reminder_enabled,
    reminder_time: String(row.reminder_time || '09:00').slice(0,5),
    reminder_at: row.reminder_at || null,
    reminder_sent_at: row.reminder_sent_at || null,
    repeat_type: row.repeat_type || 'none',
    repeat_weekday: row.repeat_weekday === null || row.repeat_weekday === undefined ? null : Number(row.repeat_weekday),
    repeat_until: row.repeat_until || null,
    excluded_dates: Array.isArray(row.excluded_dates) ? row.excluded_dates : []
  };
}
function recurrenceType(item) { return item.repeat_type || 'none'; }
function occursOnDate(item, dateISO) {
  if (item.excluded_dates?.includes(dateISO)) return false;
  if (dateISO < item.event_date) return false;
  if (item.repeat_until && dateISO > item.repeat_until) return false;
  const type = recurrenceType(item);
  if (type === 'none') return dateISO === item.event_date;
  const date = parseDate(dateISO);
  const start = parseDate(item.event_date);
  if (type === 'daily') return true;
  if (type === 'weekly') {
    const wanted = item.repeat_weekday === null || item.repeat_weekday === undefined ? start.getDay() : Number(item.repeat_weekday);
    return date.getDay() === wanted;
  }
  if (type === 'monthly') return date.getDate() === start.getDate();
  if (type === 'yearly') return date.getDate() === start.getDate() && date.getMonth() === start.getMonth();
  return dateISO === item.event_date;
}
function occurrencesForDate(items, dateISO) {
  return sortAppointments(items.filter((item) => occursOnDate(item, dateISO)).map((item) => ({ ...item, occurrence_date: dateISO })));
}
function occurrencesInRange(items, startISO, endISO) {
  const result = [];
  const start = parseDate(startISO); const end = parseDate(endISO);
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const iso = toISODate(cursor);
    occurrencesForDate(items, iso).forEach((item) => result.push(item));
  }
  return sortAppointments(result);
}
function getFilteredAppointments() {
  const query = state.search.trim().toLocaleLowerCase('it');
  if (!query) return state.appointments;
  return state.appointments.filter((item) => `${item.title} ${item.notes || ''} ${item.location || ''}`.toLocaleLowerCase('it').includes(query));
}
function sortAppointments(items) {
  return [...items].sort((a,b) => `${a.occurrence_date || a.event_date}T${a.event_time}`.localeCompare(`${b.occurrence_date || b.event_date}T${b.event_time}`));
}
function localReminderISO(eventDate, reminderTime) {
  const [y,m,d] = eventDate.split('-').map(Number);
  const [hours,minutes] = reminderTime.split(':').map(Number);
  const reminderDate = new Date(y, m - 1, d - 1, hours, minutes, 0, 0);
  return reminderDate.toISOString();
}
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function openModal(id) {
  const modal = $(id);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const modal = $(id);
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  if (!$('appointmentModal').classList.contains('hidden') || !$('accountModal').classList.contains('hidden') || !$('adminModal').classList.contains('hidden')) return;
  document.body.style.overflow = '';
}
function updateDemoNotice() {
  const notice = $('demoNotice');
  if (supabase && state.user) {
    notice.classList.add('hidden');
  } else {
    notice.classList.remove('hidden');
    notice.innerHTML = supabase
      ? '<span class="notice-dot"></span><span>Non hai effettuato l’accesso: gli impegni creati ora restano salvati solo in questo browser. Accedi per sincronizzare il tuo calendario.</span>'
      : '<span class="notice-dot"></span><span>Anteprima locale: gli appuntamenti vengono salvati solo in questo browser. Collega Supabase per attivare account, sincronizzazione ed email.</span>' ;
  }
  $('setupNotice').classList.add('hidden');
}
function renderCalendar() {
  const y = state.currentDate.getFullYear();
  const m = state.currentDate.getMonth();
  $('monthTitle').textContent = `${monthNames[m]} ${y}`;
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(y, m, 1 - offset);
  const events = getFilteredAppointments();
  const todayISO = toISODate(new Date());
  const grid = $('calendarGrid');
  grid.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dateISO = toISODate(date);
    const dayEvents = occurrencesForDate(events, dateISO);
    const cell = document.createElement('div');
    cell.className = 'calendar-day' + (date.getMonth() !== m ? ' outside' : '') + (dateISO === todayISO ? ' today' : '') + (dateISO === state.selectedDate ? ' selected' : '');
    cell.setAttribute('role','button');
    cell.setAttribute('tabindex','0');
    cell.setAttribute('aria-label', `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}, ${dayEvents.length} impegni`);
    cell.innerHTML = `<span class="day-number">${date.getDate()}</span>`;
    dayEvents.slice(0,2).forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'event-chip' + (item.reminder_enabled ? ' has-reminder' : '');
      chip.textContent = `${item.event_time} ${item.title}`;
      chip.title = `${item.event_time} · ${item.title}`;
      chip.addEventListener('click', (event) => { event.stopPropagation(); editAppointment(item.id, item.occurrence_date); });
      cell.appendChild(chip);
    });
    if (dayEvents.length > 2) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+ altri ${dayEvents.length - 2}`;
      cell.appendChild(more);
    }
    const choose = () => { state.selectedDate = dateISO; renderAll(); };
    cell.addEventListener('click', choose);
    cell.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    grid.appendChild(cell);
  }
}
function renderSelectedDay() {
  const date = parseDate(state.selectedDate);
  $('selectedDayTitle').textContent = `${date.getDate()} ${monthNames[date.getMonth()]}`;
  $('selectedDayNumber').textContent = date.getDate();
  const dayEvents = occurrencesForDate(getFilteredAppointments(), state.selectedDate);
  const holder = $('dayEvents');
  holder.innerHTML = '';
  if (!dayEvents.length) {
    holder.innerHTML = '<div class="empty-day"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/></svg>Nessun impegno per questo giorno.<br>Puoi aggiungerne uno quando vuoi.</div>';
    return;
  }
  dayEvents.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'day-event';
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = item.event_time;
    const main = document.createElement('div');
    main.className = 'event-main';
    const title = document.createElement('strong');
    title.textContent = item.title;
    main.appendChild(title);
    if (recurrenceType(item) !== 'none') {
      const repeatTag = document.createElement('span');
      repeatTag.className = 'event-repeat-label';
      repeatTag.textContent = 'Ricorrente';
      main.appendChild(repeatTag);
    }
    if (item.notes) {
      const notes = document.createElement('p');
      notes.textContent = item.notes;
      main.appendChild(notes);
    }
    if (item.location) {
      const location = document.createElement('p');
      location.className = 'event-location';
      location.textContent = `📍 ${item.location}`;
      main.appendChild(location);
      const wazeLink = document.createElement('a');
      wazeLink.className = 'waze-link';
      wazeLink.href = buildWazeUrl(item.location);
      wazeLink.target = '_blank';
      wazeLink.rel = 'noopener noreferrer';
      wazeLink.textContent = 'Apri in Waze ↗';
      wazeLink.setAttribute('aria-label', `Apri in Waze: ${item.location}`);
      wazeLink.addEventListener('click', (event) => event.stopPropagation());
      main.appendChild(wazeLink);
    }
    const reminder = document.createElement('i');
    reminder.className = `event-reminder ${item.reminder_enabled ? '' : 'off'}`;
    reminder.title = item.reminder_enabled ? 'Promemoria attivo' : 'Promemoria disattivato';
    row.append(time, main, reminder);
    row.addEventListener('click', () => editAppointment(item.id, item.occurrence_date));
    row.style.cursor = 'pointer';
    holder.appendChild(row);
  });
}
function renderUpcoming() {
  const today = toISODate(new Date());
  const horizon = new Date(); horizon.setFullYear(horizon.getFullYear() + 5);
  const items = occurrencesInRange(getFilteredAppointments(), today, toISODate(horizon)).slice(0,5);
  $('upcomingCount').textContent = items.length;
  const list = $('upcomingList');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty-upcoming">Non ci sono impegni in programma.</div>';
    return;
  }
  items.forEach((item) => {
    const date = parseDate(item.occurrence_date || item.event_date);
    const row = document.createElement('div');
    row.className = 'upcoming-item';
    row.innerHTML = `<div class="upcoming-date"><strong>${date.getDate()}</strong><span>${shortMonths[date.getMonth()]}</span></div><div class="upcoming-copy"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.event_time)} · ${item.reminder_enabled ? 'Promemoria attivo' : 'Senza promemoria'}${recurrenceType(item) !== 'none' ? ' · Ripetuto' : ''}</span>${item.location ? `<span class="upcoming-location">📍 ${escapeHTML(item.location)}</span>` : ''}</div>`;
    row.addEventListener('click', () => { const occurrenceDate = item.occurrence_date || item.event_date; state.selectedDate = occurrenceDate; state.currentDate = parseDate(occurrenceDate); renderAll(); editAppointment(item.id, occurrenceDate); });
    row.style.cursor = 'pointer';
    list.appendChild(row);
  });
}
function renderAll() {
  renderCalendar();
  renderSelectedDay();
  renderUpcoming();
  updateDemoNotice();
}
function setBusy(button, busy, busyText='Salvataggio...') {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    button.disabled = false;
  }
}
function openNewAppointment(date = state.selectedDate) {
  $('appointmentForm').reset();
  $('appointmentId').value = '';
  $('appointmentOccurrenceDate').value = '';
  $('appointmentSeriesStartDate').value = '';
  $('appointmentModalTitle').textContent = 'Nuovo impegno';
  $('saveAppointmentButton').textContent = 'Salva impegno';
  $('deleteAppointmentButton').classList.add('hidden');
  $('appointmentDate').value = date;
  $('appointmentTime').value = '09:00';
  $('appointmentRepeat').value = 'none';
  $('repeatWeekday').value = String(new Date(`${date}T12:00:00`).getDay());
  $('repeatEndMode').value = 'never';
  $('repeatUntil').value = '';
  $('reminderEnabled').checked = true;
  $('reminderTime').value = '09:00';
  $('appointmentError').textContent = '';
  $('seriesScopeRow').classList.add('hidden');
  syncReminderTimeVisibility();
  syncRecurrenceVisibility();
  openModal('appointmentModal');
  setTimeout(() => $('appointmentTitle').focus(), 50);
}
function editAppointment(id, occurrenceDate = null) {
  const item = state.appointments.find((entry) => entry.id === id);
  if (!item) return;
  const shownDate = occurrenceDate || item.event_date;
  $('appointmentId').value = item.id;
  $('appointmentOccurrenceDate').value = shownDate;
  $('appointmentSeriesStartDate').value = item.event_date;
  $('appointmentTitle').value = item.title;
  $('appointmentNotes').value = item.notes || '';
  $('appointmentLocation').value = item.location || '';
  $('appointmentDate').value = shownDate;
  $('appointmentTime').value = item.event_time;
  $('appointmentRepeat').value = recurrenceType(item);
  $('repeatWeekday').value = String(item.repeat_weekday ?? new Date(`${item.event_date}T12:00:00`).getDay());
  $('repeatEndMode').value = item.repeat_until ? 'date' : 'never';
  $('repeatUntil').value = item.repeat_until || '';
  $('reminderEnabled').checked = item.reminder_enabled;
  $('reminderTime').value = item.reminder_time || '09:00';
  $('appointmentModalTitle').textContent = 'Modifica impegno';
  $('saveAppointmentButton').textContent = 'Salva modifiche';
  $('deleteAppointmentButton').classList.remove('hidden');
  $('appointmentError').textContent = '';
  const isSeries = recurrenceType(item) !== 'none';
  $('seriesScopeRow').classList.toggle('hidden', !isSeries);
  const defaultScope = 'single';
  document.querySelector(`input[name="appointmentScope"][value="${defaultScope}"]`).checked = true;
  syncReminderTimeVisibility();
  syncRecurrenceVisibility();
  openModal('appointmentModal');
}
function syncReminderTimeVisibility() {
  $('reminderTimeRow').classList.toggle('hidden', !$('reminderEnabled').checked);
}
function syncRecurrenceVisibility() {
  const repeat = $('appointmentRepeat').value;
  $('repeatWeekdayRow').classList.toggle('hidden', repeat !== 'weekly');
  $('repeatUntilRow').classList.toggle('hidden', $('repeatEndMode').value !== 'date' || repeat === 'none');
  if (repeat === 'none') $('repeatEndMode').value = 'never';
}
function selectedSeriesScope() {
  return document.querySelector('input[name="appointmentScope"]:checked')?.value || 'single';
}
function syncSeriesScopeDate() {
  if (!$('appointmentId').value || $('seriesScopeRow').classList.contains('hidden')) return;
  $('appointmentDate').value = selectedSeriesScope() === 'series'
    ? $('appointmentSeriesStartDate').value
    : $('appointmentOccurrenceDate').value;
}
async function persistAppointmentRows(rows, deleteIds = []) {
  if (supabase && state.user) {
    for (const id of deleteIds) {
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (error) throw error;
    }
    if (rows.length) {
      const dbRows = rows.map((row) => ({ ...row, user_id: state.user.id }));
      const { error } = await supabase.from('appointments').upsert(dbRows);
      if (error) throw error;
    }
    await refreshAppointments();
    return;
  }
  deleteIds.forEach((id) => { state.appointments = state.appointments.filter((item) => item.id !== id); });
  rows.forEach((row) => {
    const index = state.appointments.findIndex((item) => item.id === row.id);
    if (index >= 0) state.appointments[index] = row;
    else state.appointments.push(row);
  });
  saveLocalAppointments();
}
async function saveAppointment(event) {
  event.preventDefault();
  const title = $('appointmentTitle').value.trim();
  const eventDate = $('appointmentDate').value;
  const eventTime = $('appointmentTime').value;
  const reminderEnabled = $('reminderEnabled').checked;
  const reminderTime = $('reminderTime').value || '09:00';
  const repeatType = $('appointmentRepeat').value || 'none';
  const repeatUntil = repeatType !== 'none' && $('repeatEndMode').value === 'date' ? $('repeatUntil').value : null;
  if (!title || !eventDate || !eventTime) {
    $('appointmentError').textContent = 'Compila il titolo, la data e l’ora.';
    return;
  }
  if (repeatUntil && repeatUntil < eventDate) {
    $('appointmentError').textContent = 'La data di fine deve essere uguale o successiva alla data iniziale.';
    return;
  }
  const id = $('appointmentId').value || crypto.randomUUID();
  const existing = state.appointments.find((item) => item.id === id);
  const occurrenceDate = $('appointmentOccurrenceDate').value || eventDate;
  const scope = existing && recurrenceType(existing) !== 'none' ? selectedSeriesScope() : 'series';
  const payload = {
    id,
    title,
    notes: $('appointmentNotes').value.trim(),
    location: $('appointmentLocation').value.trim(),
    event_date: eventDate,
    event_time: eventTime,
    reminder_enabled: reminderEnabled,
    reminder_time: reminderTime,
    reminder_at: reminderEnabled ? localReminderISO(eventDate, reminderTime) : null,
    reminder_sent_at: null,
    reminder_claimed_at: null,
    repeat_type: repeatType,
    repeat_weekday: repeatType === 'weekly' ? Number($('repeatWeekday').value) : null,
    repeat_until: repeatUntil,
    excluded_dates: existing?.excluded_dates || []
  };
  const saveButton = $('saveAppointmentButton');
  setBusy(saveButton, true);
  $('appointmentError').textContent = '';
  try {
    if (existing && recurrenceType(existing) !== 'none' && scope === 'single') {
      const master = { ...existing, excluded_dates: [...new Set([...(existing.excluded_dates || []), occurrenceDate, eventDate])] };
      const occurrenceCopy = {
        ...payload,
        id: crypto.randomUUID(),
        event_date: eventDate,
        reminder_at: reminderEnabled ? localReminderISO(eventDate, reminderTime) : null,
        repeat_type: 'none', repeat_weekday: null, repeat_until: null, excluded_dates: []
      };
      await persistAppointmentRows([master, occurrenceCopy]);
      if (state.adminDemoViewing) logAdminAction('Modifica singola occorrenza', state.adminDemoViewing, `${title} · ${occurrenceDate}`);
      state.selectedDate = eventDate;
      state.currentDate = parseDate(eventDate);
    } else {
      if (existing && recurrenceType(existing) !== 'none' && scope === 'series') {
        payload.excluded_dates = existing.excluded_dates || [];
        payload.reminder_at = reminderEnabled ? localReminderISO(payload.event_date, reminderTime) : null;
      }
      await persistAppointmentRows([payload]);
      if (state.adminDemoViewing) logAdminAction(existing ? 'Modifica impegno' : 'Creazione impegno', state.adminDemoViewing, title);
      state.selectedDate = payload.event_date;
      state.currentDate = parseDate(payload.event_date);
    }
    closeModal('appointmentModal');
    renderAll();
    showToast(supabase && state.user ? 'Impegno salvato e sincronizzato.' : 'Impegno salvato in questo browser.');
  } catch (error) {
    $('appointmentError').textContent = `Non è stato possibile salvare: ${error.message || 'controlla la connessione e riprova.'}`;
  } finally { setBusy(saveButton, false); }
}
async function deleteAppointment() {
  const id = $('appointmentId').value;
  const item = state.appointments.find((entry) => entry.id === id);
  if (!id || !item) return;
  const occurrenceDate = $('appointmentOccurrenceDate').value || item.event_date;
  const scope = recurrenceType(item) !== 'none' ? selectedSeriesScope() : 'series';
  const question = recurrenceType(item) !== 'none' && scope === 'single'
    ? `Vuoi eliminare soltanto l’occorrenza del ${occurrenceDate.split('-').reverse().join('/')}?`
    : 'Vuoi eliminare questo impegno e tutta la sua serie?';
  if (!confirm(question)) return;
  try {
    if (recurrenceType(item) !== 'none' && scope === 'single') {
      const updated = { ...item, excluded_dates: [...new Set([...(item.excluded_dates || []), occurrenceDate])] };
      await persistAppointmentRows([updated]);
      if (state.adminDemoViewing) logAdminAction('Eliminazione singola occorrenza', state.adminDemoViewing, `${item.title} · ${occurrenceDate}`);
    } else {
      await persistAppointmentRows([], [id]);
      if (state.adminDemoViewing) logAdminAction('Eliminazione impegno/serie', state.adminDemoViewing, item.title);
    }
    closeModal('appointmentModal');
    renderAll();
    showToast('Impegno eliminato.');
  } catch (error) { $('appointmentError').textContent = `Errore durante l’eliminazione: ${error.message}`; }
}
async function refreshAppointments() {
  if (supabase && state.user) {
    const { data, error } = await supabase.from('appointments').select('id,title,notes,location,event_date,event_time,reminder_enabled,reminder_time,reminder_at,reminder_sent_at,repeat_type,repeat_weekday,repeat_until,excluded_dates').order('event_date').order('event_time');
    if (error) throw error;
    state.appointments = (data || []).map(normalizeRow);
  } else {
    state.appointments = getLocalAppointments();
  }
  renderAll();
}
function updateAccountUI() {
  const email = state.user?.email || '';
  $('accountLabel').textContent = email ? (email.split('@')[0].slice(0,14) || 'Account') : 'Account';
  $('avatar').textContent = email ? email[0].toUpperCase() : 'U';
  $('signedInAvatar').textContent = email ? email[0].toUpperCase() : 'U';
  $('signedInEmail').textContent = email || 'Account collegato';
  $('accountSignedOut').classList.toggle('hidden', !!state.user);
  $('accountSignedIn').classList.toggle('hidden', !state.user);
  $('adminDemoButton').classList.toggle('hidden', !!supabase);
  updateDemoNotice();
}
function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((button) => button.classList.toggle('active', button.dataset.authTab === mode));
  $('accountModalTitle').textContent = mode === 'signup' ? 'Crea il tuo account' : 'Accedi ad Agenda';
  $('authSubmit').textContent = mode === 'signup' ? 'Crea account' : 'Accedi';
  $('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('authFeedback').textContent = '';
}
async function handleAuth(event) {
  event.preventDefault();
  if (!supabase) {
    $('authFeedback').textContent = 'Per usare gli account, prima collega un progetto Supabase in config.js.';
    return;
  }
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const button = $('authSubmit');
  setBusy(button, true, 'Attendi...');
  $('authFeedback').textContent = '';
  try {
    let result;
    if (state.authMode === 'signup') {
      result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } });
      if (result.error) throw result.error;
      $('authFeedback').textContent = 'Account creato. Controlla la posta per confermare l’indirizzo email.';
    } else {
      result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      $('authFeedback').textContent = 'Accesso effettuato.';
      setTimeout(() => closeModal('accountModal'), 500);
    }
  } catch (error) { $('authFeedback').textContent = error.message || 'Si è verificato un errore.'; }
  finally { setBusy(button, false); }
}
async function signInWithGoogle() {
  if (!supabase) { $('authFeedback').textContent = 'Collega prima Supabase in config.js per attivare l’accesso Google.'; return; }
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  if (error) $('authFeedback').textContent = error.message;
}
async function signOut() {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) { showToast(error.message); return; }
  }
  state.user = null;
  state.appointments = getLocalAppointments();
  updateAccountUI();
  renderAll();
  closeModal('accountModal');
  showToast('Hai eseguito la disconnessione.');
}
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}
async function enableNotifications() {
  if (!('Notification' in window)) { showToast('Questo browser non supporta le notifiche.'); return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { showToast('Le notifiche push non sono disponibili in questo browser.'); return; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      $('notificationStatus').textContent = 'Permesso notifiche non concesso. Puoi cambiarlo nelle impostazioni del browser.';
      showToast('Per ricevere notifiche devi autorizzarle.');
      return;
    }
    $('notificationStatus').textContent = 'Permesso notifiche concesso.';
    const registration = await navigator.serviceWorker.ready;
    if (!cfg.vapidPublicKey || cfg.vapidPublicKey.includes('INSERISCI')) {
      new Notification('Agenda: notifiche attive', { body: 'Il browser può mostrare notifiche mentre il sito è aperto. Per quelle in background occorre completare la configurazione push.' });
      showToast('Permesso attivato. Completa la configurazione push per gli avvisi in background.');
      return;
    }
    if (!supabase || !state.user) {
      new Notification('Agenda: notifiche attive', { body: 'Accedi al tuo account per collegare questo dispositivo e ricevere i promemoria.' });
      showToast('Accedi per collegare il dispositivo al tuo account.');
      return;
    }
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey) });
    const { error } = await supabase.from('push_subscriptions').upsert({ endpoint: subscription.endpoint, user_id: state.user.id, subscription: subscription.toJSON() }, { onConflict: 'endpoint' });
    if (error) throw error;
    $('notificationStatus').textContent = 'Questo dispositivo è collegato: le notifiche push sono attive.';
    showToast('Notifiche push attivate su questo dispositivo.');
    new Notification('Agenda: notifiche attive', { body: 'Questo dispositivo è pronto a ricevere i promemoria.' });
  } catch (error) {
    $('notificationStatus').textContent = `Non è stato possibile attivare le notifiche: ${error.message}`;
    showToast('Controlla i permessi e riprova.');
  }
}
async function initialize() {
  state.appointments = getLocalAppointments();
  updateAccountUI();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker non registrato:', error));
  }
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    state.user = session?.user || null;
    updateAccountUI();
    if (state.user) {
      try { await refreshAppointments(); }
      catch (error) { showToast(`Errore di sincronizzazione: ${error.message}`); }
    }
    supabase.auth.onAuthStateChange((_event, sessionNow) => {
      state.user = sessionNow?.user || null;
      updateAccountUI();
      refreshAppointments().catch((error) => showToast(`Errore di sincronizzazione: ${error.message}`));
    });
  }
  renderAll();
}

// Navigazione calendario
$('prevMonth').addEventListener('click', () => { state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth()-1, 1); renderCalendar(); });
$('nextMonth').addEventListener('click', () => { state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth()+1, 1); renderCalendar(); });
$('todayButton').addEventListener('click', () => { const today = new Date(); state.currentDate = today; state.selectedDate = toISODate(today); renderAll(); });
$('newAppointmentButton').addEventListener('click', () => openNewAppointment(state.selectedDate));
$('addForSelectedDay').addEventListener('click', () => openNewAppointment(state.selectedDate));
$('appointmentForm').addEventListener('submit', saveAppointment);
$('deleteAppointmentButton').addEventListener('click', deleteAppointment);
$('reminderEnabled').addEventListener('change', syncReminderTimeVisibility);
$('appointmentRepeat').addEventListener('change', syncRecurrenceVisibility);
$('repeatEndMode').addEventListener('change', syncRecurrenceVisibility);
document.querySelectorAll('input[name="appointmentScope"]').forEach((input) => input.addEventListener('change', syncSeriesScopeDate));
$('adminDemoButton').addEventListener('click', openAdminDemo);
$('exitAdminViewButton').addEventListener('click', exitAdminDemoView);
$('accountButton').addEventListener('click', () => openModal('accountModal'));
$('authForm').addEventListener('submit', handleAuth);
$('googleSignInButton').addEventListener('click', signInWithGoogle);
$('signOutButton').addEventListener('click', signOut);
$('enableNotificationsButton').addEventListener('click', enableNotifications);
document.querySelectorAll('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authTab)));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeModal('appointmentModal'); closeModal('accountModal'); closeModal('adminModal'); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('searchInput').focus(); }
});
$('searchInput').addEventListener('input', (event) => { state.search = event.target.value; renderAll(); });

initialize();
