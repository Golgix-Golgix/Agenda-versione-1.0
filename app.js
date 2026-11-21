
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = (id) => document.getElementById(id);
const config = window.AGENDA_CONFIG || {};
const supabaseUrl = config.supabaseUrl || '';
const supabaseKey = config.supabaseAnonKey || config.publishableKey || '';

const state = {
  supabase: null,
  user: null,
  profile: null,
  isAdmin: false,
  adminViewingUserId: null,
  adminViewingUserName: '',
  appointments: [],
  currentDate: new Date(),
  selectedDate: toISODate(new Date()),
  search: '',
 authMode: 'login',
loading: false,
passwordRecovery: false,
adminUsers: []
};

const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const shortMonths = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setNotice(message, type = 'info') {
  const notice = $('statusNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.classList.remove('hidden');
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (![...document.querySelectorAll('.modal-backdrop')].some(
    item => !item.classList.contains('hidden')
  )) {
    document.body.style.overflow = '';
  }
}

function setButtonBusy(button, busy, busyText = 'Attendi...') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

function activeCalendarUserId() {
  return state.adminViewingUserId || state.user?.id || null;
}

function normalizeAppointment(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title || '',
    notes: row.notes || '',
    location: row.location || '',
    event_date: String(row.event_date).slice(0, 10),
    event_time: String(row.event_time || '09:00').slice(0, 5),
    reminder_enabled: Boolean(row.reminder_enabled),
    reminder_time: String(row.reminder_time || '09:00').slice(0, 5),
    reminder_at: row.reminder_at || null,
    reminder_sent_at: row.reminder_sent_at || null,
    repeat_type: row.repeat_type || 'none',
    repeat_weekday: row.repeat_weekday === null ||
      row.repeat_weekday === undefined ? null : Number(row.repeat_weekday),
    repeat_until: row.repeat_until
      ? String(row.repeat_until).slice(0, 10) : null,
    excluded_dates: Array.isArray(row.excluded_dates)
      ? row.excluded_dates : []
  };
}

function getRepeatType(item) {
  return item.repeat_type || 'none';
}

function occursOnDate(item, dateISO) {
  if (dateISO < item.event_date) return false;
  if (item.repeat_until && dateISO > item.repeat_until) return false;
  if ((item.excluded_dates || []).includes(dateISO)) return false;

  const type = getRepeatType(item);
  if (type === 'none') return dateISO === item.event_date;
  if (type === 'daily') return true;

  const date = parseDate(dateISO);
  const start = parseDate(item.event_date);

  if (type === 'weekly') {
    const weekday = item.repeat_weekday === null ||
      item.repeat_weekday === undefined
      ? start.getDay()
      : Number(item.repeat_weekday);

    return date.getDay() === weekday;
  }

  if (type === 'monthly') {
    return date.getDate() === start.getDate();
  }

  if (type === 'yearly') {
    return date.getDate() === start.getDate() &&
      date.getMonth() === start.getMonth();
  }

  return dateISO === item.event_date;
}

function sortOccurrences(items) {
  return [...items].sort((a, b) => {
    const left = `${a.occurrence_date || a.event_date}T${a.event_time}`;
    const right = `${b.occurrence_date || b.event_date}T${b.event_time}`;
    return left.localeCompare(right);
  });
}

function occurrencesForDate(items, dateISO) {
  return sortOccurrences(
    items.filter(item => occursOnDate(item, dateISO))
      .map(item => ({ ...item, occurrence_date: dateISO }))
  );
}

function occurrencesInRange(items, startISO, endISO) {
  const result = [];
  const cursor = parseDate(startISO);
  const end = parseDate(endISO);
  let safety = 0;

  while (cursor <= end && safety < 2000) {
    const iso = toISODate(cursor);
    result.push(...occurrencesForDate(items, iso));
    cursor.setDate(cursor.getDate() + 1);
    safety += 1;
  }

  return sortOccurrences(result);
}

function filteredAppointments() {
  const query = state.search.trim().toLocaleLowerCase('it');

  if (!query) return state.appointments;

  return state.appointments.filter(item =>
    `${item.title} ${item.notes} ${item.location}`
      .toLocaleLowerCase('it').includes(query)
  );
}

function wazeUrl(location) {
  const url = new URL('https://waze.com/ul');
  url.searchParams.set('q', location.trim());
  url.searchParams.set('navigate', 'yes');
  return url.toString();
}

/* CALENDARIO */

function renderCalendar() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();

  $('monthTitle').textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1, 12);
  const offset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - offset, 12);
  const todayISO = toISODate(new Date());
  const grid = $('calendarGrid');

  grid.replaceChildren();

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
      12
    );

    const dateISO = toISODate(date);
    const dayItems = occurrencesForDate(
      filteredAppointments(),
      dateISO
    );

    const cell = document.createElement('div');
    cell.className = 'calendar-day';

    if (date.getMonth() !== month) cell.classList.add('outside');
    if (dateISO === todayISO) cell.classList.add('today');
    if (dateISO === state.selectedDate) cell.classList.add('selected');

    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute(
      'aria-label',
      `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}, ${dayItems.length} impegni`
    );

    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = String(date.getDate());
    cell.appendChild(number);

    dayItems.slice(0, 2).forEach(item => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `event-chip${item.reminder_enabled ? ' has-reminder' : ''}`;
      chip.textContent = `${item.event_time} ${item.title}`;
      chip.title = `${item.event_time} · ${item.title}`;

      chip.addEventListener('click', event => {
        event.stopPropagation();
        editAppointment(item.id, item.occurrence_date);
      });

      cell.appendChild(chip);
    });

    if (dayItems.length > 2) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+ altri ${dayItems.length - 2}`;
      cell.appendChild(more);
    }

    const selectDay = () => {
      state.selectedDate = dateISO;
      renderAll();
    };

    cell.addEventListener('click', selectDay);

    cell.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectDay();
      }
    });

    grid.appendChild(cell);
  }
}

function renderSelectedDay() {
  const date = parseDate(state.selectedDate);

  $('selectedDayTitle').textContent =
    `${date.getDate()} ${monthNames[date.getMonth()]}`;

  $('selectedDayNumber').textContent = String(date.getDate());

  const items = occurrencesForDate(
    filteredAppointments(),
    state.selectedDate
  );

  const holder = $('dayEvents');
  holder.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-day';
    empty.textContent =
      'Nessun impegno per questo giorno. Puoi aggiungerne uno quando vuoi.';
    holder.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'day-event';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');

    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = item.event_time;

    const main = document.createElement('div');
    main.className = 'event-main';

    const title = document.createElement('strong');
    title.textContent = item.title;
    main.appendChild(title);

    if (getRepeatType(item) !== 'none') {
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

      const link = document.createElement('a');
      link.className = 'waze-link';
      link.href = wazeUrl(item.location);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Apri in Waze ↗';
      link.addEventListener('click', event => event.stopPropagation());
      main.appendChild(link);
    }

    const marker = document.createElement('i');
    marker.className =
      `event-reminder${item.reminder_enabled ? '' : ' off'}`;
    marker.title = item.reminder_enabled
      ? 'Promemoria attivo'
      : 'Promemoria disattivato';

    const openEditor = () => editAppointment(item.id, item.occurrence_date);

    row.addEventListener('click', openEditor);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEditor();
      }
    });

    row.append(time, main, marker);
    holder.appendChild(row);
  });
}

function renderUpcoming() {
  const today = toISODate(new Date());
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 2);

  const items = occurrencesInRange(
    filteredAppointments(),
    today,
    toISODate(horizon)
  ).slice(0, 5);

  $('upcomingCount').textContent = String(items.length);

  const holder = $('upcomingList');
  holder.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-upcoming';
    empty.textContent = 'Non ci sono impegni in programma.';
    holder.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const date = parseDate(item.occurrence_date || item.event_date);

    const row = document.createElement('div');
    row.className = 'upcoming-item';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');

    const dateBox = document.createElement('div');
    dateBox.className = 'upcoming-date';

    const day = document.createElement('strong');
    day.textContent = String(date.getDate());

    const month = document.createElement('span');
    month.textContent = shortMonths[date.getMonth()];

    dateBox.append(day, month);

    const copy = document.createElement('div');
    copy.className = 'upcoming-copy';

    const title = document.createElement('strong');
    title.textContent = item.title;

    const meta = document.createElement('span');
    meta.textContent =
      `${item.event_time} · ${item.reminder_enabled ? 'Promemoria attivo' : 'Senza promemoria'}${getRepeatType(item) !== 'none' ? ' · Ricorrente' : ''}`;

    copy.append(title, meta);

    if (item.location) {
      const location = document.createElement('span');
      location.className = 'upcoming-location';
      location.textContent = `📍 ${item.location}`;
      copy.appendChild(location);
    }

    const open = () => {
      const dateISO = item.occurrence_date || item.event_date;
      state.selectedDate = dateISO;
      state.currentDate = parseDate(dateISO);
      renderAll();
      editAppointment(item.id, dateISO);
    };

    row.addEventListener('click', open);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });

    row.append(dateBox, copy);
    holder.appendChild(row);
  });
}

function renderAll() {
  const signedIn = Boolean(state.user);

 $('authGate').classList.toggle(
  'hidden',
  signedIn && !state.passwordRecovery
);

$('appWorkspace').hidden =
  !signedIn || state.passwordRecovery;
  $('adminViewBanner').classList.toggle(
    'hidden',
    !state.adminViewingUserId
  );

  if (state.adminViewingUserId) {
    $('adminViewedUserName').textContent = state.adminViewingUserName;
  }

  if (!signedIn) return;

  renderCalendar();
  renderSelectedDay();
  renderUpcoming();
}

/* CARICAMENTO DEI DATI */

async function loadAppointments() {
  if (!state.user || !state.supabase) return;

  const targetUserId = activeCalendarUserId();
  if (!targetUserId) return;

  const { data, error } = await state.supabase
    .from('appointments')
    .select('*')
    .eq('user_id', targetUserId)
    .order('event_date', { ascending: true })
    .order('event_time', { ascending: true });

  if (error) throw error;

  state.appointments = (data || []).map(normalizeAppointment);
  renderAll();
}

function localReminderTimestamp(dateISO, time) {
  const [year, month, day] = dateISO.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  return new Date(
    year, month - 1, day - 1, hour, minute, 0, 0
  ).toISOString();
}

async function saveRows(rows, deleteIds = []) {
  const client = state.supabase;
  const targetUserId = activeCalendarUserId();

  if (!client || !targetUserId) {
    throw new Error('Sessione non disponibile. Accedi di nuovo.');
  }

  if (deleteIds.length) {
    const { error } = await client
      .from('appointments')
      .delete()
      .in('id', deleteIds)
      .eq('user_id', targetUserId);

    if (error) throw error;
  }

  if (rows.length) {
    const payload = rows.map(row => ({
      ...row,
      user_id: targetUserId
    }));

    const { error } = await client
      .from('appointments')
      .upsert(payload, { onConflict: 'id' });

    if (error) throw error;
  }

  await loadAppointments();
}

/* CREAZIONE E MODIFICA IMPEGNI */

function syncReminderVisibility() {
  $('reminderTimeRow').classList.toggle(
    'hidden',
    !$('reminderEnabled').checked
  );
}

function syncRepeatVisibility() {
  const type = $('appointmentRepeat').value;

  $('repeatWeekdayRow').classList.toggle('hidden', type !== 'weekly');

  $('repeatUntilRow').classList.toggle(
    'hidden',
    $('repeatEndMode').value !== 'date' || type === 'none'
  );

  if (type === 'none') {
    $('repeatEndMode').value = 'never';
  }
}

function selectedScope() {
  return document.querySelector(
    'input[name="appointmentScope"]:checked'
  )?.value || 'single';
}

function syncScopeDate() {
  if (
    !$('appointmentId').value ||
    $('seriesScopeRow').classList.contains('hidden')
  ) return;

  $('appointmentDate').value = selectedScope() === 'series'
    ? $('appointmentSeriesStartDate').value
    : $('appointmentOccurrenceDate').value;
}

function openNewAppointment(dateISO = state.selectedDate) {
  $('appointmentForm').reset();

  $('appointmentId').value = '';
  $('appointmentOccurrenceDate').value = '';
  $('appointmentSeriesStartDate').value = '';

  $('appointmentModalTitle').textContent = 'Nuovo impegno';
  $('saveAppointmentButton').textContent = 'Salva impegno';
  $('deleteAppointmentButton').classList.add('hidden');

  $('appointmentDate').value = dateISO;
  $('appointmentTime').value = '09:00';
  $('appointmentRepeat').value = 'none';
  $('repeatWeekday').value = String(parseDate(dateISO).getDay());
  $('repeatEndMode').value = 'never';
  $('repeatUntil').value = '';

  $('reminderEnabled').checked = true;
  $('reminderTime').value = '09:00';
  $('appointmentError').textContent = '';
  $('seriesScopeRow').classList.add('hidden');

  syncReminderVisibility();
  syncRepeatVisibility();

  openModal('appointmentModal');
  setTimeout(() => $('appointmentTitle').focus(), 50);
}

function editAppointment(id, occurrenceDate) {
  const item = state.appointments.find(entry => entry.id === id);
  if (!item) return;

  $('appointmentId').value = item.id;
  $('appointmentOccurrenceDate').value = occurrenceDate || item.event_date;
  $('appointmentSeriesStartDate').value = item.event_date;

  $('appointmentTitle').value = item.title;
  $('appointmentNotes').value = item.notes;
  $('appointmentLocation').value = item.location;
  $('appointmentDate').value = occurrenceDate || item.event_date;
  $('appointmentTime').value = item.event_time;

  $('appointmentRepeat').value = getRepeatType(item);
  $('repeatWeekday').value = String(
    item.repeat_weekday ?? parseDate(item.event_date).getDay()
  );
  $('repeatEndMode').value = item.repeat_until ? 'date' : 'never';
  $('repeatUntil').value = item.repeat_until || '';

  $('reminderEnabled').checked = item.reminder_enabled;
  $('reminderTime').value = item.reminder_time || '09:00';

  $('appointmentModalTitle').textContent = 'Modifica impegno';
  $('saveAppointmentButton').textContent = 'Salva modifiche';
  $('deleteAppointmentButton').classList.remove('hidden');
  $('appointmentError').textContent = '';

  const recurring = getRepeatType(item) !== 'none';
  $('seriesScopeRow').classList.toggle('hidden', !recurring);

  const defaultScope = document.querySelector(
    'input[name="appointmentScope"][value="single"]'
  );

  if (defaultScope) defaultScope.checked = true;

  syncReminderVisibility();
  syncRepeatVisibility();
  openModal('appointmentModal');
}

async function handleAppointmentSave(event) {
  event.preventDefault();

  const button = $('saveAppointmentButton');
  const title = $('appointmentTitle').value.trim();
  const date = $('appointmentDate').value;
  const time = $('appointmentTime').value;
  const repeatType = $('appointmentRepeat').value || 'none';
  const reminderEnabled = $('reminderEnabled').checked;
  const reminderTime = $('reminderTime').value || '09:00';

  const repeatUntil =
    repeatType !== 'none' && $('repeatEndMode').value === 'date'
      ? $('repeatUntil').value
      : null;

  if (!title || !date || !time) {
    $('appointmentError').textContent =
      'Inserisci titolo, data e ora.';
    return;
  }

  if (repeatUntil && repeatUntil < date) {
    $('appointmentError').textContent =
      'La data di fine deve essere uguale o successiva alla data iniziale.';
    return;
  }

  const id = $('appointmentId').value || crypto.randomUUID();
  const existing = state.appointments.find(item => item.id === id);
  const occurrenceDate = $('appointmentOccurrenceDate').value || date;

  const scope = existing && getRepeatType(existing) !== 'none'
    ? selectedScope()
    : 'series';

  const reminderAt = reminderEnabled
    ? localReminderTimestamp(date, reminderTime)
    : null;

  const record = {
    id,
    title,
    notes: $('appointmentNotes').value.trim(),
    location: $('appointmentLocation').value.trim(),
    event_date: date,
    event_time: time,
    reminder_enabled: reminderEnabled,
    reminder_time: reminderTime,
    reminder_at: reminderAt,
    reminder_sent_at: null,
    reminder_claimed_at: null,
    repeat_type: repeatType,
    repeat_weekday: repeatType === 'weekly'
      ? Number($('repeatWeekday').value)
      : null,
    repeat_until: repeatUntil,
    excluded_dates: existing?.excluded_dates || []
  };

  setButtonBusy(button, true, 'Salvataggio...');
  $('appointmentError').textContent = '';

  try {
    if (existing && getRepeatType(existing) !== 'none' && scope === 'single') {
      const master = {
        ...existing,
        excluded_dates: [
          ...new Set([...(existing.excluded_dates || []), occurrenceDate])
        ]
      };

      const exception = {
        ...record,
        id: crypto.randomUUID(),
        repeat_type: 'none',
        repeat_weekday: null,
        repeat_until: null,
        excluded_dates: []
      };

      await saveRows([master, exception]);
    } else {
      await saveRows([record]);
    }

    state.selectedDate = date;
    state.currentDate = parseDate(date);

    closeModal('appointmentModal');
    renderAll();
    showToast('Impegno salvato nel tuo account.');
  } catch (error) {
    $('appointmentError').textContent =
      `Salvataggio non riuscito: ${error.message || 'riprova.'}`;
  } finally {
    setButtonBusy(button, false);
  }
}

async function handleAppointmentDelete() {
  const id = $('appointmentId').value;
  const item = state.appointments.find(entry => entry.id === id);

  if (!id || !item) return;

  const occurrenceDate =
    $('appointmentOccurrenceDate').value || item.event_date;

  const scope = getRepeatType(item) !== 'none'
    ? selectedScope()
    : 'series';

  const question = getRepeatType(item) !== 'none' && scope === 'single'
    ? `Eliminare soltanto l'appuntamento del ${occurrenceDate.split('-').reverse().join('/')}?`
    : 'Eliminare questo impegno e tutta la serie?';

  if (!confirm(question)) return;

  try {
    if (getRepeatType(item) !== 'none' && scope === 'single') {
      const updated = {
        ...item,
        excluded_dates: [
          ...new Set([...(item.excluded_dates || []), occurrenceDate])
        ]
      };

      await saveRows([updated]);
    } else {
      await saveRows([], [id]);
    }

    closeModal('appointmentModal');
    renderAll();
    showToast('Impegno eliminato.');
  } catch (error) {
    $('appointmentError').textContent =
      `Eliminazione non riuscita: ${error.message || 'riprova.'}`;
  }
}

/* AUTENTICAZIONE */

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === 'signup';

  document.querySelectorAll('[data-auth-tab]').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.authTab === mode
    );
  });

  $('authHeading').textContent = signup
    ? 'Crea il tuo account'
    : 'Accedi ad Agenda';

  $('authIntro').textContent = signup
    ? 'Registrati con il tuo nome, email e una password.'
    : 'Accedi al tuo account per visualizzare il tuo calendario.';

  $('authSubmit').textContent = signup ? 'Crea account' : 'Accedi';
  $('authNameRow').classList.toggle('hidden', !signup);
  $('authFullName').required = signup;
  $('authPassword').autocomplete = signup
    ? 'new-password'
    : 'current-password';

  $('authFeedback').textContent = '';
  $('resetPasswordButton').classList.toggle('hidden', signup);
}

async function handleAuth(event) {
  event.preventDefault();

  if (!state.supabase || state.loading) return;

  const email = $('authEmail').value.trim().toLowerCase();
  const password = $('authPassword').value;
  const fullName = $('authFullName').value.trim();

  if (password.length < 8) {
    $('authFeedback').textContent =
      'La password deve contenere almeno 8 caratteri.';
    return;
  }

  if (state.authMode === 'signup' && !fullName) {
    $('authFeedback').textContent = 'Inserisci il tuo nome.';
    return;
  }

  state.loading = true;
  setButtonBusy($('authSubmit'), true, 'Attendi...');
  $('authFeedback').textContent = '';

  try {
    if (state.authMode === 'signup') {
      const { data, error } = await state.supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo:
            `${window.location.origin}${window.location.pathname}`
        }
      });

      if (error) throw error;

      if (data.session) {
        await loadUserSession(data.user);
        $('authFeedback').textContent =
          'Account creato e accesso effettuato.';
      } else {
        $('authFeedback').textContent =
          'Registrazione avviata. Controlla la tua email e conferma l’indirizzo prima di accedere.';
      }
    } else {
      const { data, error } =
        await state.supabase.auth.signInWithPassword({
          email,
          password
        });

      if (error) throw error;

      await loadUserSession(data.user);
      $('authFeedback').textContent = 'Accesso effettuato.';
    }
  } catch (error) {
    $('authFeedback').textContent =
      error.message || 'Non è stato possibile completare l’operazione.';
  } finally {
    state.loading = false;
    setButtonBusy($('authSubmit'), false);
  }
}

async function handleGoogleSignIn() {
  if (!state.supabase) return;

  $('authFeedback').textContent = '';

  const { error } = await state.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`
    }
  });

  if (error) {
    $('authFeedback').textContent = error.message;
  }
}

async function handlePasswordReset() {
  if (!state.supabase) return;

  const email = $('authEmail').value.trim().toLowerCase();

  if (!email) {
    $('authFeedback').textContent =
      'Inserisci prima il tuo indirizzo email.';
    $('authEmail').focus();
    return;
  }

  const { error } = await state.supabase.auth.resetPasswordForEmail(
    email,
    {
      redirectTo:
        `${window.location.origin}${window.location.pathname}?password_recovery=1`
    }
  );

  $('authFeedback').textContent = error
    ? error.message
    : 'Se l’indirizzo è registrato, riceverai un messaggio per reimpostare la password.';
}
function showPasswordRecoveryPanel() {
  state.passwordRecovery = true;

  $('passwordRecoveryPanel').classList.remove('hidden');
  $('authForm').classList.add('hidden');

  document.querySelector('.auth-tabs')
    ?.classList.add('hidden');

  $('resetPasswordButton').classList.add('hidden');

  document.querySelector('.auth-divider')
    ?.classList.add('hidden');

  $('googleSignInButton').classList.add('hidden');

  $('authHeading').textContent =
    'Imposta una nuova password';

  $('authIntro').textContent =
    'Scegli una nuova password per recuperare il tuo account.';

  $('passwordRecoveryFeedback').textContent = '';

  renderAll();
}


async function handlePasswordRecoverySubmit(event) {
  event.preventDefault();

  const password = $('recoveryPassword').value;
  const confirmation = $('recoveryPasswordConfirm').value;

  const feedback = $('passwordRecoveryFeedback');
  const button = $('saveRecoveryPasswordButton');

  if (!state.supabase) {
    feedback.textContent = 'Servizio non disponibile. Riprova.';
    return;
  }

  if (password.length < 8) {
    feedback.textContent =
      'La password deve contenere almeno 8 caratteri.';
    return;
  }

  if (password !== confirmation) {
    feedback.textContent =
      'Le due password non coincidono.';
    return;
  }

  setButtonBusy(button, true, 'Aggiornamento...');
  feedback.textContent = '';

  try {
    const { data, error } =
      await state.supabase.auth.updateUser({
        password: password
      });

    if (error) throw error;

    state.passwordRecovery = false;

    $('passwordRecoveryPanel').classList.add('hidden');
    $('authForm').classList.remove('hidden');

    document.querySelector('.auth-tabs')
      ?.classList.remove('hidden');

    document.querySelector('.auth-divider')
      ?.classList.remove('hidden');

    $('googleSignInButton').classList.remove('hidden');

    $('passwordRecoveryForm').reset();

    setAuthMode('login');

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );

    await loadUserSession(data.user || state.user);

    showToast('Password aggiornata correttamente.');

  } catch (error) {
    feedback.textContent =
      error.message ||
      'Non è stato possibile aggiornare la password.';

  } finally {
    setButtonBusy(button, false);
  }
}
/* SESSIONE E PROFILO */

async function loadUserSession(user) {
  state.user = user || null;
  state.profile = null;
  state.isAdmin = false;
  state.adminViewingUserId = null;
  state.adminViewingUserName = '';
  state.appointments = [];

  if (!user) {
    updateAccountUI();
    renderAll();
    return;
  }

  const [
    { data: profile, error: profileError },
    { data: isAdmin, error: adminError }
  ] = await Promise.all([
    state.supabase
      .from('profiles')
      .select('id,email,full_name,created_at')
      .eq('id', user.id)
      .maybeSingle(),

    state.supabase.rpc('is_agenda_admin')
  ]);

  if (profileError) console.error('Profilo non caricato:', profileError);
  if (adminError) console.error('Verifica amministratore non riuscita:', adminError);

  state.profile = profile || {
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name || ''
  };

  state.isAdmin = !adminError && isAdmin === true;

  updateAccountUI();
  await loadAppointments();
  renderAll();
}

function updateAccountUI() {
  const email = state.user?.email || '';
  const name =
    state.profile?.full_name ||
    state.user?.user_metadata?.full_name ||
    email.split('@')[0] ||
    'Utente';

  $('accountLabel').textContent = email ? name.slice(0, 16) : 'Account';
  $('avatar').textContent = name ? name[0].toUpperCase() : 'U';
  $('signedInAvatar').textContent = name ? name[0].toUpperCase() : 'U';
  $('signedInName').textContent = name;
  $('signedInEmail').textContent = email;
  $('adminPanelButton').hidden = !state.isAdmin;
}

async function signOut() {
  if (!state.supabase) return;

  const { error } = await state.supabase.auth.signOut();

  if (error) {
    $('accountFeedback').textContent = error.message;
    return;
  }

  state.user = null;
  state.profile = null;
  state.isAdmin = false;
  state.adminViewingUserId = null;
  state.appointments = [];

  updateAccountUI();
  renderAll();
  closeModal('accountModal');
  showToast('Hai eseguito la disconnessione.');
}

/* PANNELLO AMMINISTRATORE REALE */

async function openAdminPanel() {
  if (!state.isAdmin) {
    showToast('Non hai i permessi per accedere a questa sezione.');
    return;
  }

  $('adminFeedback').textContent = 'Caricamento utenti...';
  $('adminUserList').replaceChildren();
  openModal('adminModal');

  const { data, error } = await state.supabase
    .from('profiles')
    .select('id,email,full_name,created_at')
    .order('created_at', { ascending: false });

  if (error) {
    $('adminFeedback').textContent =
      `Impossibile caricare gli utenti: ${error.message}`;
    return;
  }

  state.adminUsers = data || [];
  renderAdminUsers();
  $('adminFeedback').textContent =
    `${state.adminUsers.length} account trovati.`;
}

function renderAdminUsers() {
  const holder = $('adminUserList');
  const query = ($('adminUserSearch').value || '').trim().toLowerCase();

  holder.replaceChildren();

  const users = (state.adminUsers || []).filter(user =>
    `${user.full_name || ''} ${user.email || ''}`
      .toLowerCase().includes(query)
  );

  if (!users.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-audit-empty';
    empty.textContent = 'Nessun utente trovato.';
    holder.appendChild(empty);
    return;
  }

  users.forEach(user => {
    const card = document.createElement('div');
    card.className = 'admin-user-card';

    const info = document.createElement('div');
    info.className = 'admin-user-info';

    const name = document.createElement('strong');
    name.textContent = user.full_name || 'Nome non impostato';

    const email = document.createElement('span');
    email.textContent = user.email || '';

    info.append(name, email);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = 'Apri agenda';

    button.addEventListener('click', async () => {
      state.adminViewingUserId = user.id;
      state.adminViewingUserName =
        user.full_name || user.email || 'utente';

      state.selectedDate = toISODate(new Date());
      state.currentDate = new Date();

      closeModal('adminModal');
      closeModal('accountModal');

      try {
        await loadAppointments();
        renderAll();
      } catch (error) {
        state.adminViewingUserId = null;
        state.adminViewingUserName = '';
        showToast(`Impossibile aprire l’agenda: ${error.message}`);
      }
    });

    card.append(info, button);
    holder.appendChild(card);
  });
}

async function exitAdminView() {
  if (!state.isAdmin || !state.adminViewingUserId) return;

  state.adminViewingUserId = null;
  state.adminViewingUserName = '';
  state.selectedDate = toISODate(new Date());
  state.currentDate = new Date();

  try {
    await loadAppointments();
    renderAll();
  } catch (error) {
    showToast(`Impossibile tornare alla tua agenda: ${error.message}`);
  }
}

/* AVVIO E COLLEGAMENTO SUPABASE */

async function initialize() {
  if (!supabaseUrl || !supabaseKey) {
    setNotice(
      'Configurazione Supabase mancante. Il sito non può effettuare accessi finché config.js non è configurato.',
      'error'
    );
    $('authFeedback').textContent =
      'Configurazione Supabase incompleta.';
    return;
  }

  try {
    state.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });

    const { data, error } = await state.supabase.auth.getSession();
    if (error) throw error;

    if (data.session?.user) {
      await loadUserSession(data.session.user);
    } else {
      updateAccountUI();
      renderAll();
    }

    state.supabase.auth.onAuthStateChange((event, session) => {

  if (event === 'PASSWORD_RECOVERY') {
    showPasswordRecoveryPanel();
  }
      const user = session?.user || null;

      // Il caricamento parte fuori dal callback Auth.
      setTimeout(() => {
        loadUserSession(user).catch(error => {
          console.error('Errore durante il caricamento della sessione:', error);
          setNotice(
            `Errore di accesso ai dati: ${error.message}`,
            'error'
          );
        });
      }, 0);
    });

    if (new URLSearchParams(window.location.search).has('password_recovery')) {
      $('authFeedback').textContent =
        'Apri il link ricevuto via email per proseguire con il recupero della password.';
    }
  } catch (error) {
    console.error(error);
    setNotice(
      `Impossibile collegarsi a Supabase: ${error.message || 'verifica la configurazione.'}`,
      'error'
    );
    $('authFeedback').textContent =
      'Connessione al servizio non riuscita. Riprova più tardi.';
    renderAll();
  }
}

/* EVENTI DELL'INTERFACCIA */

$('prevMonth').addEventListener('click', () => {
  state.currentDate = new Date(
    state.currentDate.getFullYear(),
    state.currentDate.getMonth() - 1,
    1
  );
  renderCalendar();
});

$('nextMonth').addEventListener('click', () => {
  state.currentDate = new Date(
    state.currentDate.getFullYear(),
    state.currentDate.getMonth() + 1,
    1
  );
  renderCalendar();
});

$('todayButton').addEventListener('click', () => {
  const today = new Date();
  state.currentDate = today;
  state.selectedDate = toISODate(today);
  renderAll();
});

$('newAppointmentButton').addEventListener(
  'click',
  () => openNewAppointment()
);

$('addForSelectedDay').addEventListener(
  'click',
  () => openNewAppointment()
);

$('appointmentForm').addEventListener(
  'submit',
  handleAppointmentSave
);

$('deleteAppointmentButton').addEventListener(
  'click',
  handleAppointmentDelete
);

$('reminderEnabled').addEventListener(
  'change',
  syncReminderVisibility
);

$('appointmentRepeat').addEventListener(
  'change',
  syncRepeatVisibility
);

$('repeatEndMode').addEventListener(
  'change',
  syncRepeatVisibility
);

document.querySelectorAll('input[name="appointmentScope"]').forEach(input => {
  input.addEventListener('change', syncScopeDate);
});

$('searchInput').addEventListener('input', event => {
  state.search = event.target.value;
  renderAll();
});

$('accountButton').addEventListener('click', () => {
  if (state.user) {
    openModal('accountModal');
  } else {
    $('authEmail').focus();
    window.scrollTo({
      top: $('authGate').offsetTop - 20,
      behavior: 'smooth'
    });
  }
});

$('authForm').addEventListener('submit', handleAuth);
$('googleSignInButton').addEventListener('click', handleGoogleSignIn);
$('resetPasswordButton').addEventListener('click', handlePasswordReset);
$('signOutButton').addEventListener('click', signOut);
$('adminPanelButton').addEventListener('click', openAdminPanel);
$('adminUserSearch').addEventListener('input', renderAdminUsers);
$('exitAdminViewButton').addEventListener('click', exitAdminView);

document.querySelectorAll('[data-auth-tab]').forEach(button => {
  button.addEventListener('click', () => setAuthMode(button.dataset.authTab));
});

document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => closeModal(button.dataset.close));
});

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeModal(backdrop.id);
  });
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(modal => {
      closeModal(modal.id);
    });
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('searchInput').focus();
  }
});

setAuthMode('login');
initialize();
