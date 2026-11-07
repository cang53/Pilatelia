const thisWeek = mondayOf(new Date());
let week = thisWeek;
let slots = [];
let chosen = null;

const $ = (s) => document.querySelector(s);
const list = $('#slots');
const dialog = $('#dialog');
const form = $('#form');

async function load() {
  $('#weekLabel').textContent = weekLabel(week);
  $('#prev').disabled = week <= thisWeek;
  list.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    slots = await api(`/api/slots?${weekQuery(week)}`);
    render();
  } catch (err) {
    list.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

function render() {
  if (!slots.length) {
    list.innerHTML = '<p class="empty">Aucun créneau disponible cette semaine.<br>Essayez la semaine suivante.</p>';
    return;
  }
  list.innerHTML = [...byDay(slots)].map(([day, items]) => `
    <section class="day">
      <h2>${fmt.day.format(new Date(`${day}T12:00`))}</h2>
      ${items.map((s) => {
        const left = s.capacity - s.booked;
        return `<div class="slot">
          <p class="slot-time">${fmt.time.format(new Date(s.starts_at))}<small>${s.duration_minutes} min</small></p>
          <div class="slot-info"><strong>${esc(s.title)}</strong>
            <span class="${left > 0 ? 'muted' : 'full'}">${left > 0 ? `${plural(left, 'place')} libre${left > 1 ? 's' : ''}` : 'Complet'}</span></div>
          <button class="btn" data-id="${s.id}" ${left > 0 ? '' : 'disabled'}>Réserver</button>
        </div>`;
      }).join('')}
    </section>`).join('');
}

const describe = (s) => `${fmt.day.format(new Date(s.starts_at))} à ${fmt.time.format(new Date(s.starts_at))} · ${s.duration_minutes} min`;

list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  chosen = slots.find((s) => s.id === btn.dataset.id);
  $('#dialogTitle').textContent = chosen.title;
  $('#dialogMeta').textContent = describe(chosen);
  $('#formError').textContent = '';
  form.hidden = false;
  $('#done').hidden = true;
  try { // pré-remplit pour les habituées
    const saved = JSON.parse(localStorage.getItem('pilatelia-me') || '{}');
    form.name.value ||= saved.name || '';
    form.email.value ||= saved.email || '';
  } catch {}
  dialog.showModal();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  $('#formError').textContent = '';
  const me = { name: form.name.value, email: form.email.value };
  try {
    await api('/api/book', { method: 'POST', body: JSON.stringify({ slot_id: chosen.id, ...me }) });
    try { localStorage.setItem('pilatelia-me', JSON.stringify(me)); } catch {}
    $('#doneText').textContent = `${chosen.title}, ${describe(chosen)}. À bientôt !`;
    form.hidden = true;
    $('#done').hidden = false;
    load();
  } catch (err) {
    $('#formError').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

dialog.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dialog.close(); });
$('#prev').addEventListener('click', () => { week = addDays(week, -7); load(); });
$('#next').addEventListener('click', () => { week = addDays(week, 7); load(); });
// Ouvre directement la semaine du prochain créneau (dans les 6 semaines).
api(`/api/slots?from=${new Date().toISOString()}&to=${addDays(thisWeek, 42).toISOString()}`)
  .then((next) => { if (next[0]) week = mondayOf(new Date(next[0].starts_at)); })
  .catch(() => {})
  .finally(load);
