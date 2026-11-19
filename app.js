const $ = (id) => document.getElementById(id);
const cfg = window.AGENDA_CONFIG || {};
const hasSupabaseConfig = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.supabaseUrl || '') && !!cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes('INSERISCI');
let supabase = null;
if (hasSupabaseConfig) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
}
const STORAGE_KEY = 'agenda-appointments-v1';
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
  busy: false
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
function getLocalAppointments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
function saveLocalAppointments() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.appointments));
}
function normalizeRow(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || '',
    event_date: row.event_date,
    event_time: String(row.event_time || '09:00').slice(0,5),
    reminder_enabled: !!row.reminder_enabled,
    reminder_time: String(row.reminder_time || '09:00').slice(0,5),
    reminder_at: row.reminder_at || null,
    reminder_sent_at: row.reminder_sent_at || null
  };
}
function getFilteredAppointments() {
  const query = state.search.trim().toLocaleLowerCase('it');
  if (!query) return state.appointments;
  return state.appointments.filter((item) => `${item.title} ${item.notes || ''}`.toLocaleLowerCase('it').includes(query));
}
function sortAppointments(items) {
  return [...items].sort((a,b) => `${a.event_date}T${a.event_time}`.localeCompare(`${b.event_date}T${b.event_time}`));
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
  if (!$('appointmentModal').classList.contains('hidden') || !$('accountModal').classList.contains('hidden')) return;
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
    const dayEvents = sortAppointments(events.filter((item) => item.event_date === dateISO));
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
      chip.addEventListener('click', (event) => { event.stopPropagation(); editAppointment(item.id); });
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
  const dayEvents = sortAppointments(getFilteredAppointments().filter((item) => item.event_date === state.selectedDate));
  const holder = $('dayEvents');
  holder.innerHTML = '';
  if (!dayEvents.length) {
    holder.innerHTML = '<div class="empty-day"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/></svg>Nessun impegno per questo giorno.<br>Puoi aggiungerne uno quando vuoi.</div>';
    return;
  }
  dayEvents.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'day-event';
    row.innerHTML = `<span class="event-time">${escapeHTML(item.event_time)}</span><div class="event-main"><strong>${escapeHTML(item.title)}</strong>${item.notes ? `<p>${escapeHTML(item.notes)}</p>` : ''}</div><i class="event-reminder ${item.reminder_enabled ? '' : 'off'}" title="${item.reminder_enabled ? 'Promemoria attivo' : 'Promemoria disattivato'}"></i>`;
    row.addEventListener('click', () => editAppointment(item.id));
    row.style.cursor = 'pointer';
    holder.appendChild(row);
  });
}
function renderUpcoming() {
  const today = toISODate(new Date());
  const items = sortAppointments(getFilteredAppointments().filter((item) => item.event_date >= today)).slice(0,5);
  $('upcomingCount').textContent = items.length;
  const list = $('upcomingList');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty-upcoming">Non ci sono impegni in programma.</div>';
    return;
  }
  items.forEach((item) => {
    const date = parseDate(item.event_date);
    const row = document.createElement('div');
    row.className = 'upcoming-item';
    row.innerHTML = `<div class="upcoming-date"><strong>${date.getDate()}</strong><span>${shortMonths[date.getMonth()]}</span></div><div class="upcoming-copy"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.event_time)} · ${item.reminder_enabled ? 'Promemoria attivo' : 'Senza promemoria'}</span></div>`;
    row.addEventListener('click', () => { state.selectedDate = item.event_date; state.currentDate = parseDate(item.event_date); renderAll(); editAppointment(item.id); });
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
  $('appointmentModalTitle').textContent = 'Nuovo impegno';
  $('saveAppointmentButton').textContent = 'Salva impegno';
  $('deleteAppointmentButton').classList.add('hidden');
  $('appointmentDate').value = date;
  $('appointmentTime').value = '09:00';
  $('reminderEnabled').checked = true;
  $('reminderTime').value = '09:00';
  $('appointmentError').textContent = '';
  syncReminderTimeVisibility();
  openModal('appointmentModal');
  setTimeout(() => $('appointmentTitle').focus(), 50);
}
function editAppointment(id) {
  const item = state.appointments.find((entry) => entry.id === id);
  if (!item) return;
  $('appointmentId').value = item.id;
  $('appointmentTitle').value = item.title;
  $('appointmentNotes').value = item.notes || '';
  $('appointmentDate').value = item.event_date;
  $('appointmentTime').value = item.event_time;
  $('reminderEnabled').checked = item.reminder_enabled;
  $('reminderTime').value = item.reminder_time || '09:00';
  $('appointmentModalTitle').textContent = 'Modifica impegno';
  $('saveAppointmentButton').textContent = 'Salva modifiche';
  $('deleteAppointmentButton').classList.remove('hidden');
  $('appointmentError').textContent = '';
  syncReminderTimeVisibility();
  openModal('appointmentModal');
}
function syncReminderTimeVisibility() {
  $('reminderTimeRow').classList.toggle('hidden', !$('reminderEnabled').checked);
}
async function saveAppointment(event) {
  event.preventDefault();
  const title = $('appointmentTitle').value.trim();
  const eventDate = $('appointmentDate').value;
  const eventTime = $('appointmentTime').value;
  const reminderEnabled = $('reminderEnabled').checked;
  const reminderTime = $('reminderTime').value || '09:00';
  if (!title || !eventDate || !eventTime) {
    $('appointmentError').textContent = 'Compila il titolo, la data e l’ora.';
    return;
  }
  const id = $('appointmentId').value || crypto.randomUUID();
  const payload = {
    id,
    title,
    notes: $('appointmentNotes').value.trim(),
    event_date: eventDate,
    event_time: eventTime,
    reminder_enabled: reminderEnabled,
    reminder_time: reminderTime,
    reminder_at: reminderEnabled ? localReminderISO(eventDate, reminderTime) : null,
    reminder_sent_at: null,
    reminder_claimed_at: null
  };
  const saveButton = $('saveAppointmentButton');
  setBusy(saveButton, true);
  $('appointmentError').textContent = '';
  try {
    if (supabase && state.user) {
      const dbPayload = { ...payload, user_id: state.user.id };
      const { error } = await supabase.from('appointments').upsert(dbPayload);
      if (error) throw error;
      await refreshAppointments();
    } else {
      const index = state.appointments.findIndex((item) => item.id === id);
      if (index >= 0) state.appointments[index] = payload;
      else state.appointments.push(payload);
      saveLocalAppointments();
    }
    state.selectedDate = eventDate;
    state.currentDate = parseDate(eventDate);
    closeModal('appointmentModal');
    renderAll();
    showToast(supabase && state.user ? 'Impegno salvato e sincronizzato.' : 'Impegno salvato in questo browser.');
  } catch (error) {
    $('appointmentError').textContent = `Non è stato possibile salvare: ${error.message || 'controlla la connessione e riprova.'}`;
  } finally { setBusy(saveButton, false); }
}
async function deleteAppointment() {
  const id = $('appointmentId').value;
  if (!id || !confirm('Vuoi eliminare questo impegno?')) return;
  try {
    if (supabase && state.user) {
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (error) throw error;
      await refreshAppointments();
    } else {
      state.appointments = state.appointments.filter((item) => item.id !== id);
      saveLocalAppointments();
    }
    closeModal('appointmentModal');
    renderAll();
    showToast('Impegno eliminato.');
  } catch (error) { $('appointmentError').textContent = `Errore durante l’eliminazione: ${error.message}`; }
}
async function refreshAppointments() {
  if (supabase && state.user) {
    const { data, error } = await supabase.from('appointments').select('id,title,notes,event_date,event_time,reminder_enabled,reminder_time,reminder_at,reminder_sent_at').order('event_date').order('event_time');
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
$('accountButton').addEventListener('click', () => openModal('accountModal'));
$('authForm').addEventListener('submit', handleAuth);
$('googleSignInButton').addEventListener('click', signInWithGoogle);
$('signOutButton').addEventListener('click', signOut);
$('enableNotificationsButton').addEventListener('click', enableNotifications);
document.querySelectorAll('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authTab)));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeModal('appointmentModal'); closeModal('accountModal'); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('searchInput').focus(); }
});
$('searchInput').addEventListener('input', (event) => { state.search = event.target.value; renderAll(); });

initialize();
