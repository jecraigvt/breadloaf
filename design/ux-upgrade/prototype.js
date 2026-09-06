/* Breadloaf Hill design study. All interactions and sample data stay in this page. */
const app = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const concepts = ['cabin', 'fieldguide', 'homestead'];
const screens = ['hub', 'calendar', 'rooms', 'bucky', 'upload', 'tasks'];
const concept = concepts.includes(params.get('concept')) ? params.get('concept') : 'cabin';
const rooms = [
  { id: 'tom', name: 'Tom’s Room', bed: 'Queen bed · Private bath', capacity: 2 },
  { id: 'jim', name: 'Jim’s Room', bed: 'Queen bed · Private bath', capacity: 2 },
  { id: 'sandy', name: 'Sandy’s Room', bed: 'King bed · Private bath', capacity: 2 },
  { id: 'greg', name: 'Greg’s Room', bed: 'Queen bed · Private bath', capacity: 2 },
  { id: 'wedge', name: 'Wedge Room', bed: 'Twin beds', capacity: 2 },
  { id: 'upper', name: 'Upper Annex', bed: 'Twin beds', capacity: 2 },
  { id: 'lower', name: 'Lower Annex', bed: 'Twin beds', capacity: 2 },
  { id: 'loft', name: 'Loft', bed: 'Twin beds', capacity: 2 },
  { id: 'cabin', name: 'Woods Cabin', bed: 'Twin beds · Compost toilet', capacity: 2 },
  { id: 'tents', name: 'Tents', bed: 'A little closer to the stars', capacity: 4 },
  { id: 'offsite', name: 'Off-site', bed: 'Staying nearby', capacity: 0 },
];
const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  bed: '<path d="M3 18V7m18 11V7M3 12h18M3 17h18M7 8h3v4H7zm7 0h3v4h-3z"/>',
  book: '<path d="M12 5v16M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4v4H7zm8 0h2M15 12h2M7 16h10"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 3v4m-2-2h4"/>',
  file: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v3"/>',
  leaf: '<path d="M20 3C9 2 3 7 4 14c1 6 8 7 12 3 3-3 4-8 4-14ZM3 21 15 9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const toISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = (value) => new Date(`${value}T12:00:00`);
const dateLabel = (value, options = { month: 'short', day: 'numeric' }) => parseDate(value).toLocaleDateString('en-US', options);
const statusLabel = (status) => ({ confirmed: 'Confirmed', tentative: 'Tentative', requested: 'Requested' }[status] || status);
const roomName = (id) => rooms.find((room) => room.id === id)?.name || 'Room to be decided';
const makeState = () => ({
  screen: screens.includes(params.get('screen')) ? params.get('screen') : 'hub',
  month: new Date(2026, 8, 1),
  selectedDay: '2026-09-11',
  calendarView: 'month',
  stays: [
    { id: 'visit-1', guest: 'Alex & Morgan', room: 'tom', checkIn: '2026-09-11', checkOut: '2026-09-14', status: 'confirmed', notes: 'A long weekend on the hill.' },
    { id: 'visit-2', guest: 'Casey & Jamie', room: 'upper', checkIn: '2026-09-18', checkOut: '2026-09-21', status: 'tentative', notes: 'Hoping for a little early fall color.' },
  ],
  selectedFile: null,
  uploadedBy: '',
  uploadState: 'select',
  task: { state: 'waiting', filename: 'Autumn maintenance notes.pdf', title: 'Autumn maintenance notes', category: 'Maintenance', summary: 'A short checklist for the next visit: check the window screens, put away the garden hose, and restock kindling by the hearth.', mode: 'background' },
  messages: [{ role: 'assistant', text: 'Welcome back to the hill. I can help you plan a visit, find something in the archive, or keep an eye on your background tasks.' }],
  notice: '',
  modal: null,
});
let state = makeState();
let previousFocus = null;
document.body.dataset.concept = concept;

const button = (text, action, kind = 'secondary', glyph = '', attrs = '') => `<button type="button" class="button ${kind}" data-action="${action}" ${attrs}>${glyph ? icon(glyph) : ''}<span>${text}</span></button>`;
const screenButton = (text, screen, kind = 'secondary', glyph = '') => `<button type="button" class="button ${kind}" data-screen="${screen}">${glyph ? icon(glyph) : ''}<span>${text}</span></button>`;
const heading = (number, title, lede, action = '') => `<div class="page-heading"><div><p class="eyebrow">${number} / Breadloaf Hill</p><h1 tabindex="-1" class="focus-target">${title}</h1><p class="lede">${lede}</p></div>${action}</div>`;
const sectionHeading = (title, caption = '') => `<div class="section-heading"><h2>${title}</h2>${caption ? `<span class="eyebrow">${caption}</span>` : ''}</div>`;
function visitRows(stays = state.stays, compact = false) {
  return stays.length ? `<div class="visit-list">${[...stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn)).map((stay) => `<article class="visit-row"><div class="visit-date"><strong>${dateLabel(stay.checkIn, { day: 'numeric' })}</strong><span>${dateLabel(stay.checkIn, { month: 'short' })}</span></div><div class="visit-copy"><h3>${esc(stay.guest)}</h3><p>${dateLabel(stay.checkIn)}–${dateLabel(stay.checkOut)} · ${esc(roomName(stay.room))}</p>${compact ? '' : `<p class="visit-note">${esc(stay.notes)}</p>`}</div><span class="pill ${stay.status}">${statusLabel(stay.status)}</span></article>`).join('')}</div>` : '<div class="empty-state"><p>No visits on these dates. A little room to make plans.</p></div>';
}
function taskPill() {
  const labels = { waiting: '1 task waiting', running: 'Bucky is working', complete: '1 task ready', error: '1 task needs attention', undone: 'Analysis undone' };
  return `<span class="pill"><span class="status-dot ${state.task.state}"></span>${labels[state.task.state]}</span>`;
}
function hero() {
  return `<section class="hero" aria-label="Welcome to Breadloaf Hill"><img class="hero-photo" src="${concept === 'fieldguide' ? '/photos/hero-rainbow.jpg' : '/photos/hero-drone-house.jpg'}" alt="${concept === 'fieldguide' ? 'A rainbow over the meadow at Breadloaf Hill' : 'The Breadloaf Hill house framed by Vermont greenery'}"><div class="hero-copy"><p class="hero-kicker eyebrow">Ripton, Vermont · Est. 1974</p><h1 class="hero-title focus-target" tabindex="-1">A place to<br><em>come together.</em></h1><p class="hero-caption">The days slow down. The door stays open.</p></div><span class="hero-number eyebrow">01 / Our place</span></section>`;
}
function overview() {
  return `<div class="overview-strip"><div class="overview-stat"><span class="eyebrow">On the hill</span><strong>${icon('sun')} 68° <small>Clear skies</small></strong></div><div class="overview-stat"><span class="eyebrow">Next visit</span><strong>Sep 11 <small>Alex & Morgan</small></strong></div><div class="overview-stat"><span class="eyebrow">This season</span><strong>Early fall <small>A little quieter</small></strong></div></div>`;
}
function hubTile(type) {
  const definitions = {
    bucky: { title: 'Bucky', meta: 'A hand around the house', number: 'I', glyph: 'spark', screen: 'bucky' },
    calendar: { title: 'Calendar', meta: 'See who’s coming', number: 'II', photo: '/photos/hero-mountains.jpg', alt: 'A view across the Green Mountains', screen: 'calendar' },
    rooms: { title: 'Rooms', meta: 'Find your place to stay', number: 'III', photo: '/photos/house-interior.jpg', alt: 'The warm wood-paneled house interior', screen: 'rooms' },
    family: { title: 'Family', meta: 'The people who make this home', number: 'IV', glyph: 'people', screen: 'family' },
    more: { title: 'All Tools', meta: 'Archive, supplies & everything else', number: 'V', glyph: 'book', screen: 'more' },
  };
  const tile = definitions[type];
  return `<button type="button" class="hub-tile tile-${type}" data-screen="${tile.screen}">${tile.photo ? `<img class="tile-photo" src="${tile.photo}" alt="${tile.alt}">` : ''}<span class="tile-copy"><span class="tile-number eyebrow">${tile.number}${tile.glyph ? icon(tile.glyph) : ''}</span><span class="tile-title">${tile.title}</span><span class="tile-meta">${tile.meta}</span>${type === 'bucky' ? taskPill() : ''}<span class="tile-arrow">${icon('arrow')}</span></span></button>`;
}
function quickActions() {
  return `<div class="hub-actions">${screenButton('Add to Archive', 'upload', 'text-button', 'upload')}${screenButton('Bucky’s tasks', 'tasks', 'text-button', 'clock')}</div>`;
}
function hub() {
  if (concept === 'homestead') {
    return `<div class="welcome-row"><div><p class="eyebrow">Saturday, September 5</p><h1 class="focus-target" tabindex="-1">Good to be <em>back.</em></h1><p class="lede">Your next good day on the hill starts here.</p></div><img src="/photos/hero-drone-house.jpg" alt="Breadloaf Hill house among the trees"></div><div class="status-board">${overview()}<div class="status-board-bucky">${icon('spark')}<div><strong>Bucky has things in hand.</strong><p>Keep an eye on your archive and background tasks.</p></div>${screenButton('View tasks', 'tasks', 'secondary')}</div></div><div class="hub-layout"><section class="hub-primary">${sectionHeading('Make yourself at home', 'Everyday essentials')}<div class="hub-tiles">${hubTile('bucky')}${hubTile('calendar')}${hubTile('rooms')}${hubTile('family')}${hubTile('more')}</div>${quickActions()}</section><aside class="hub-secondary panel">${sectionHeading('Coming up', 'Around the house')}${visitRows(state.stays, true)}${button('Add Visit', 'stay-open', 'primary', 'plus')}<div class="inline-note"><p class="eyebrow">A little reminder</p><p>Good company. A full wood box. Not much else needed.</p></div></aside></div>`;
  }
  if (concept === 'fieldguide') {
    return `${hero()}${overview()}<div class="hub-layout"><section class="hub-primary"><div class="chapter-intro"><p class="eyebrow">The family field guide / September</p><h2>A familiar place.<br><em>A few new possibilities.</em></h2></div><div class="hub-tiles">${hubTile('bucky')}${hubTile('calendar')}${hubTile('rooms')}</div>${quickActions()}</section><aside class="hub-secondary"><section class="feature-story panel"><p class="eyebrow">Next on the calendar</p><h2>A long weekend<br><em>on the hill.</em></h2>${visitRows(state.stays.slice(0, 1), true)}<div class="button-row">${screenButton('See all dates', 'calendar', 'secondary')}${button('Add Visit', 'stay-open', 'text-button', 'plus')}</div></section><section class="panel">${sectionHeading('The good things', 'Keep close')}<div class="hub-tiles">${hubTile('family')}${hubTile('more')}</div></section></aside></div>`;
  }
  return `${hero()}${overview()}<div class="hub-layout"><section class="hub-primary"><div class="chapter-intro"><p class="eyebrow">The family hub</p><h2>Everything for your<br><em>time on the hill.</em></h2></div><div class="hub-tiles">${hubTile('bucky')}${hubTile('calendar')}${hubTile('rooms')}${hubTile('family')}${hubTile('more')}</div>${quickActions()}</section><aside class="hub-secondary"><section class="panel">${sectionHeading('Coming together', 'The next visits')}${visitRows(state.stays, true)}${button('Add Visit', 'stay-open', 'secondary', 'plus')}</section><div class="pull-quote"><p>“The best part is<br>who’s here.”</p><span class="eyebrow">A family place, always</span></div></aside></div>`;
}
function calendar() {
  const monthLabel = state.month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const year = state.month.getFullYear();
  const month = state.month.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  const first = new Date(year, month, 1).getDay();
  const monthEnd = toISO(new Date(year, month + 1, 1));
  const monthStays = state.stays.filter((stay) => stay.checkIn < monthEnd && stay.checkOut > toISO(state.month));
  const dayStays = state.stays.filter((stay) => stay.checkIn <= state.selectedDay && stay.checkOut > state.selectedDay);
  const cells = Array.from({ length: Math.ceil((first + count) / 7) * 7 }, (_, index) => {
    const day = index - first + 1;
    if (day < 1 || day > count) return '<span class="calendar-cell empty" aria-hidden="true"></span>';
    const value = toISO(new Date(year, month, day));
    const stays = state.stays.filter((stay) => stay.checkIn <= value && stay.checkOut > value);
    return `<button type="button" class="calendar-cell ${value === state.selectedDay ? 'selected' : ''} ${value === '2026-09-05' ? 'today' : ''} ${stays.length ? 'has-visit' : ''}" data-action="select-day" data-date="${value}" aria-pressed="${value === state.selectedDay}" aria-label="${dateLabel(value, { weekday: 'long', month: 'long', day: 'numeric' })}${stays.length ? `, ${stays.length} visit${stays.length > 1 ? 's' : ''}` : ', no visits'}"><span class="calendar-day-number">${day}</span>${stays.length ? '<span class="calendar-dot" aria-hidden="true"></span>' : ''}</button>`;
  }).join('');
  return `${heading('II', 'Calendar', 'See who’s coming to Breadloaf Hill.', button('Add Visit', 'stay-open', 'primary', 'plus'))}<div class="calendar-layout"><section class="panel calendar-panel" aria-label="Family visit calendar"><div class="calendar-toolbar">${button('', 'month-prev', 'icon-button', 'left', 'aria-label="Previous month"')}<h2 aria-live="polite">${monthLabel}</h2>${button('', 'month-next', 'icon-button', 'right', 'aria-label="Next month"')}</div><div class="view-toggle" role="group" aria-label="Calendar view">${button('Month', 'view-month', state.calendarView === 'month' ? 'active' : '', '', `aria-pressed="${state.calendarView === 'month'}"`)}${button('List', 'view-list', state.calendarView === 'list' ? 'active' : '', '', `aria-pressed="${state.calendarView === 'list'}"`)}</div>${state.calendarView === 'month' ? `<div class="weekdays" aria-hidden="true">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => `<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><div class="calendar-legend"><span><i class="calendar-dot"></i> A family visit</span><span><i class="today-marker"></i> Today in this preview</span></div>` : visitRows(monthStays)}</section><aside class="panel day-detail"><p class="eyebrow">${state.calendarView === 'month' ? 'Selected day' : 'Planning ahead'}</p><h2>${state.calendarView === 'month' ? dateLabel(state.selectedDay, { weekday: 'long', month: 'short', day: 'numeric' }) : 'A place for everyone'}</h2>${state.calendarView === 'month' ? visitRows(dayStays, true) : '<p>Check a few dates, find a room, and let the family know you’re coming.</p>'}<div class="button-row">${button('Add Visit', 'stay-open', 'secondary', 'plus')}${screenButton('See rooms', 'rooms', 'text-button', 'bed')}</div><p class="small-note">Visits are sample data. Changes you make here stay in this preview.</p></aside></div>${state.calendarView === 'month' ? `<section class="panel">${sectionHeading('This month', `${monthStays.length} planned visits`)}${visitRows(monthStays)}</section>` : ''}`;
}
function roomScreen() {
  const relevant = state.stays.filter((stay) => stay.checkIn <= state.selectedDay && stay.checkOut > state.selectedDay);
  return `${heading('III', 'Stays & Rooms', 'Plan visits and pick your room.', button('Add Stay', 'stay-open', 'primary', 'plus'))}<div class="overview-strip"><div class="overview-stat"><span class="eyebrow">Under one roof</span><strong>9 <small>Rooms & cabin</small></strong></div><div class="overview-stat"><span class="eyebrow">On the calendar</span><strong>${state.stays.length} <small>Upcoming stays</small></strong></div><div class="overview-stat"><span class="eyebrow">Also welcome</span><strong>Outdoors <small>Tents & off-site</small></strong></div></div><div class="split-layout"><section><div class="section-heading"><h2>Find your corner</h2><label class="room-date-label" for="room-date">On <input type="date" id="room-date" value="${state.selectedDay}"></label></div><div class="room-grid">${rooms.map((room, index) => {
    const occupant = relevant.find((stay) => stay.room === room.id);
    return `<article class="room-card ${occupant ? 'occupied' : ''}">${index === 0 ? '<img class="room-photo" src="/photos/house-interior.jpg" alt="Warm wood interiors at Breadloaf Hill">' : ''}<div class="room-card-body"><div class="room-meta"><span class="eyebrow">${String(index + 1).padStart(2, '0')} / ${index < 4 ? 'Main house' : index < 9 ? 'A little more room' : 'Other stays'}</span>${icon(index < 9 ? 'bed' : 'leaf')}</div><h3>${room.name}</h3><p>${room.bed}</p><span class="pill ${occupant ? occupant.status : 'available'}">${occupant ? `${esc(occupant.guest)} · ${statusLabel(occupant.status)}` : 'Available in this preview'}</span>${button(occupant ? 'Plan another stay' : 'Choose this room', 'stay-open', 'text-button', 'arrow', `data-room="${room.id}"`)}</div></article>`;
  }).join('')}</div></section><aside class="panel">${sectionHeading('Upcoming stays')}${visitRows(state.stays)}${screenButton('Open calendar', 'calendar', 'secondary', 'calendar')}<p class="small-note">Room details and dates are illustrative. This preview does not check real availability.</p></aside></div>`;
}
function bucky() {
  return `${heading('I', 'Bucky', 'A little help with life on the hill.', screenButton('Bucky’s tasks', 'tasks', 'secondary', 'clock'))}<div class="chat-layout"><section class="panel chat-panel"><div class="bucky-intro">${icon('spark')}<div><p class="eyebrow">Your property assistant</p><h2>What’s on your mind?</h2></div></div><div class="chat-messages" role="log" aria-label="Demo conversation">${state.messages.map((message) => `<div class="chat-message ${message.role}"><span class="eyebrow">${message.role === 'assistant' ? 'Bucky' : 'You'}</span><p>${esc(message.text)}</p></div>`).join('')}</div><div class="chat-suggestions">${button('Who’s coming next?', 'chat-suggestion', 'secondary', '', 'data-prompt="Who’s coming next?"')}${button('Help me add a document', 'chat-suggestion', 'secondary', '', 'data-prompt="Help me add a document"')}${button('Check my background tasks', 'chat-suggestion', 'secondary', '', 'data-prompt="Check my background tasks"')}</div><form class="chat-composer" data-form="chat"><label class="sr-only" for="chat-input">Message Bucky</label><textarea id="chat-input" name="message" rows="2" maxlength="500" placeholder="Ask Bucky about the house…" required></textarea><button class="button primary" type="submit" aria-label="Send message to Bucky">${icon('arrow')}<span>Send</span></button></form><p class="small-note">A sample conversation, with preset replies. Nothing is sent to an AI service.</p></section><aside class="panel"><p class="eyebrow">Take a shortcut</p><h2>A few things<br><em>I can help with.</em></h2><div class="shortcut-list">${screenButton('Plan your next visit', 'calendar', 'text-button', 'calendar')}${screenButton('Add to Archive', 'upload', 'text-button', 'upload')}${screenButton('Bucky’s tasks', 'tasks', 'text-button', 'clock')}</div><div class="inline-note">${taskPill()}<p>Your original document is saved while Bucky works in the background.</p></div></aside></div>`;
}
function upload() {
  const selected = state.selectedFile;
  const saved = state.uploadState === 'saved';
  const complete = state.uploadState === 'complete';
  return `${heading('Archive', 'Add to Archive', 'Keep the useful things. Make them easy to find.', screenButton('Bucky’s tasks', 'tasks', 'secondary', 'clock'))}<div class="split-layout"><section class="panel upload-panel">${saved || complete ? `<div class="upload-confirmation"><span class="success-icon">${icon('check')}</span><p class="eyebrow">${complete ? 'Analysis ready' : 'Original saved'}</p><h2>${complete ? 'Filed and ready to find.' : 'You’re all set.'}</h2><p><strong>${esc(selected?.name || state.task.filename)}</strong></p><p>${complete ? 'Bucky has suggested a title, category, and summary for this sample document.' : 'Your original is safe in the archive. Bucky will add the details when background analysis finishes.'}</p>${complete ? taskResult() : '<div class="inline-notice"><span class="status-dot waiting"></span> Background analysis is waiting to begin.</div>'}<div class="button-row">${screenButton('View background task', 'tasks', 'primary', 'clock')}${button('Add another', 'upload-reset', 'secondary', 'plus')}</div></div>` : selected ? `<div class="file-preview"><span class="file-icon">${icon('file')}</span><div><p class="eyebrow">Ready to add</p><h2>${esc(selected.name)}</h2><p>${selected.sample ? 'Sample PDF · 2 pages' : `${Math.max(1, Math.round(selected.size / 1024)).toLocaleString()} KB · Filename preview only`}</p></div>${button('Remove', 'upload-reset', 'text-button', 'close')}</div><div class="form-field"><label for="uploaded-by">Your name</label><input id="uploaded-by" name="uploadedBy" placeholder="Name or family" value="${esc(state.uploadedBy)}" autocomplete="off" maxlength="80"></div><div class="analysis-options"><div class="analysis-option"><p class="eyebrow">Stay for the result</p><h3>Upload &amp; Analyze</h3><p>Review Bucky’s suggested title, category, and summary here.</p>${button('Upload & Analyze', 'upload-now', 'secondary', 'spark')}</div><div class="analysis-option recommended"><span class="pill">Keep moving</span><h3>Analyze in background</h3><p>Save the original now. Check Bucky’s tasks when the details are ready.</p>${button('Analyze in background', 'upload-background', 'primary', 'clock')}</div></div><p class="small-note">Preview only: the file is never read or uploaded. Both actions simulate saving a sample.</p>` : `<div class="upload-zone"><div class="upload-illustration">${icon('upload')}</div><p class="eyebrow">A home for the house’s history</p><h2>What would you<br><em>like to keep?</em></h2><p>Notes, receipts, manuals, photos, and the things someone will need someday.</p><input id="archive-file" class="sr-only" type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp" aria-label="Choose a file to preview"><div class="button-row">${button('Choose a file', 'file-choose', 'primary', 'upload')}${button('Try a sample document', 'sample-file', 'secondary', 'file')}</div><p class="small-note">PDF, Word, spreadsheets, text, and images.<br>Local files stay on your device.</p></div><div class="upload-alternatives">${button('Scan with camera', 'preview-feature', 'text-button', '', 'data-feature="Camera scanning"')}${button('Add a link', 'preview-feature', 'text-button', '', 'data-feature="Add a link"')}</div>`}</section><aside class="panel archive-details"><p class="eyebrow">A little less filing</p><h2>Save it once.<br><em>Find it later.</em></h2><ol class="task-steps"><li><span>1</span><div><h3>Add your original</h3><p>Your file gets a place in the family archive.</p></div></li><li><span>2</span><div><h3>Bucky reads the details</h3><p>A useful title, category, and summary help it make sense.</p></div></li><li><span>3</span><div><h3>Keep the family in the loop</h3><p>Come back to your task to see the result, or retry if something needs attention.</p></div></li></ol><p class="small-note">This design preview uses a fictional maintenance note. No real documents or account data are connected.</p></aside></div>`;
}
function taskResult() {
  return `<div class="task-result"><p class="eyebrow">Bucky’s suggested filing</p><h3>${esc(state.task.title)}</h3><span class="pill">${state.task.category}</span><p>${state.task.summary}</p><div class="task-tags"><span>Seasonal care</span><span>Next visit</span></div></div>`;
}
function tasks() {
  const task = state.task;
  const labels = { waiting: 'Waiting to begin', running: 'Analysis in progress', complete: 'Analysis complete', error: 'Needs a little attention', undone: 'Analysis undone' };
  const descriptions = {
    waiting: 'Your original is saved. Bucky will pick this up when background processing is available.',
    running: 'Bucky is reading the document and putting the useful details together. You can leave this page.',
    complete: 'Your document now has a useful title, category, and summary. The original is kept alongside it.',
    error: 'Bucky couldn’t finish this time. Your original is still safe, and you can try again.',
    undone: 'The suggested filing has been removed. Your original document is still saved.',
  };
  const progress = { waiting: 15, running: 62, complete: 100, error: 62, undone: 0 }[task.state];
  return `${heading('Bucky', 'Bucky’s tasks', 'The little things, moving along.', screenButton('Add to Archive', 'upload', 'secondary', 'plus'))}<div class="split-layout"><section><article class="panel task-card" data-task-state="${task.state}"><div class="task-card-header"><span class="file-icon">${icon('file')}</span><div><p class="eyebrow">Document analysis · Just now</p><h2>${esc(task.filename)}</h2></div><span class="pill ${task.state}"><span class="status-dot ${task.state}"></span>${labels[task.state]}</span></div><div class="task-progress"><div class="progress-track" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="Simulated analysis progress"><span style="width:${progress}%"></span></div><p class="task-description" role="status">${descriptions[task.state]}</p></div><ol class="task-steps horizontal"><li class="done"><span>${icon('check')}</span><div><h3>Original saved</h3><p>Kept in your archive</p></div></li><li class="${['running', 'complete', 'error'].includes(task.state) ? 'current' : ''}"><span>${task.state === 'complete' ? icon('check') : '2'}</span><div><h3>Read & organize</h3><p>${task.state === 'complete' ? 'Details added' : 'Background analysis'}</p></div></li><li class="${task.state === 'complete' ? 'done' : ''}"><span>${task.state === 'complete' ? icon('check') : '3'}</span><div><h3>Ready to find</h3><p>Review the result</p></div></li></ol>${task.state === 'complete' ? taskResult() : ''}<div class="button-row">${task.state === 'error' ? button('Retry analysis', 'task-retry', 'primary', 'arrow') : ''}${task.state === 'undone' ? button('Analyze again', 'task-retry', 'primary', 'spark') : ''}${task.state === 'complete' ? `${button('View in Archive', 'preview-feature', 'primary', 'book', 'data-feature="Document archive"')}${button('Undo analysis', 'task-undo', 'text-button')}` : ''}${button('View original', 'preview-original', 'secondary', 'file')}</div></article><div class="demo-controls"><p class="eyebrow">Prototype controls</p><p>Explore the waiting, progress, completed, and recoverable error states.</p><div class="button-row">${button(task.state === 'waiting' ? 'Start analysis' : task.state === 'running' ? 'Complete analysis' : 'Restart demonstration', 'task-progress', 'secondary', 'arrow')}${button('Simulate an error', 'task-error', 'text-button')}</div></div></section><aside class="panel"><p class="eyebrow">No need to wait here</p><h2>A useful little<br><em>helping hand.</em></h2><p>Save a document and carry on. Its task keeps a clear record of what happened and what comes next.</p><div class="inline-notice">${icon('check')}<span>Your original stays in the archive, even if analysis needs another try.</span></div>${screenButton('Ask Bucky', 'bucky', 'text-button', 'spark')}<p class="small-note">Every state on this page is simulated. The controls do not start real background work.</p></aside></div>`;
}

function modalMarkup() {
  if (!state.modal) return '';
  const modal = state.modal;
  const closeButton = button('', 'modal-close', 'icon-button', 'close', 'aria-label="Close dialog"');
  let content;
  if (modal.type === 'stay') {
    const addTitle = state.screen === 'rooms' ? 'Add Stay' : 'Add Visit';
    content = `<div class="dialog-header"><div><p class="eyebrow">Make a little time</p><h2 id="dialog-title">${addTitle}</h2></div>${closeButton}</div><p id="dialog-description" class="small-note">Create a sample stay. Nothing is added to the live calendar.</p><form data-form="stay"><div class="form-field"><label for="guest-name">Guest name</label><input id="guest-name" name="guest" placeholder="Name or family" maxlength="80" required autocomplete="off" autofocus></div><div class="form-row"><div class="form-field"><label for="check-in">Check in</label><input id="check-in" name="checkIn" type="date" value="${state.selectedDay}" required></div><div class="form-field"><label for="check-out">Check out</label><input id="check-out" name="checkOut" type="date" value="${toISO(new Date(parseDate(state.selectedDay).getTime() + 3 * 86400000))}" required></div></div><div class="form-field"><label for="room-preference">Room preference</label><select id="room-preference" name="room"><option value="">Decide later</option>${rooms.map((room) => `<option value="${room.id}" ${room.id === modal.room ? 'selected' : ''}>${room.name}${room.capacity ? ` (sleeps ${room.capacity})` : ''}</option>`).join('')}</select></div><div class="form-field"><label for="stay-status">Status</label><select id="stay-status" name="status"><option value="confirmed">Confirmed</option><option value="tentative">Tentative</option><option value="requested">Requested</option></select></div><div class="form-field"><label for="stay-notes">Notes</label><textarea id="stay-notes" name="notes" rows="2" maxlength="300" placeholder="Arriving late, bringing kids, dietary needs…"></textarea></div><p class="form-error" id="stay-error" role="alert" hidden></p><div class="dialog-actions">${button('Cancel', 'modal-close', 'secondary')}<button class="button primary" type="submit" data-action="stay-save">${icon('plus')}${addTitle}</button></div></form>`;
  } else if (modal.type === 'original') {
    content = `<div class="dialog-header"><div><p class="eyebrow">Saved original / Preview</p><h2 id="dialog-title">${esc(state.task.filename)}</h2></div>${closeButton}</div><p id="dialog-description">This is a simulated document preview. No selected file has been read.</p><div class="sample-document"><p class="eyebrow">Breadloaf Hill · Sample note</p><h3>For the next visit</h3><p>Check the window screens. Put away the garden hose. Restock kindling by the hearth.</p><p class="small-note">Fictional content for comparing these designs.</p></div><div class="dialog-actions">${button('Close preview', 'modal-close', 'primary')}</div>`;
  } else {
    const feature = modal.feature || 'This destination';
    content = `<div class="dialog-header"><div><p class="eyebrow">Beyond this design preview</p><h2 id="dialog-title">${esc(feature)}</h2></div>${closeButton}</div><p id="dialog-description">${esc(feature)} keeps its familiar place in the upgraded site. This comparison focuses on the Hub, Calendar, Stays & Rooms, Bucky, Add to Archive, and Bucky’s tasks.</p><p>Use the same navigation to continue exploring. No live page or service opens here.</p>${feature === 'All Tools' ? `<div class="shortcut-list">${screenButton('Add to Archive', 'upload', 'secondary', 'upload')}${screenButton('Bucky’s tasks', 'tasks', 'secondary', 'clock')}</div>` : ''}<div class="dialog-actions">${button('Keep exploring', 'modal-close', 'primary')}</div>`;
  }
  return `<div class="dialog-overlay"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description" tabindex="-1">${content}</section></div>`;
}
function nav() {
  return `<footer class="site-nav"><nav aria-label="Main navigation">${[['Hub', 'hub', 'home'], ['Dates', 'calendar', 'calendar'], ['Rooms', 'rooms', 'bed'], ['Guide', 'guide', 'book'], ['Board', 'board', 'board']].map(([label, screen, glyph]) => `<button type="button" data-screen="${screen}" class="nav-item ${state.screen === screen ? 'active' : ''}" ${state.screen === screen ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></button>`).join('')}</nav></footer>`;
}
function render({ focusHeading = false, focusSelector = null, scrollTop = false } = {}) {
  const content = { hub, calendar, rooms: roomScreen, bucky, upload, tasks }[state.screen]();
  app.innerHTML = `<article class="app-shell"><header class="site-header"><button class="wordmark" type="button" data-screen="hub" aria-label="Breadloaf Hill home">Breadloaf Hill<span class="wordmark-dot">.</span></button><div class="header-meta"><span class="eyebrow">Family house / Vermont</span><span class="identity" aria-label="Sample family profile">BH</span></div></header><div class="preview-notice">Interactive design preview <span aria-hidden="true">·</span> Sample data only</div><main id="main-content" tabindex="-1" data-current-screen="${state.screen}">${state.notice ? `<div class="inline-notice saved-notice" role="status">${icon('check')}<span>${esc(state.notice)}</span>${button('Dismiss', 'notice-dismiss', 'text-button')}</div>` : ''}${content}<div class="utility-links" aria-label="Prototype shortcuts">${screenButton('Bucky', 'bucky', 'text-button')}${screenButton('Add to Archive', 'upload', 'text-button')}${screenButton('Bucky’s tasks', 'tasks', 'text-button')}</div><p class="footer-note eyebrow">A family place in the Green Mountains</p></main>${nav()}</article>${modalMarkup()}`;
  document.body.classList.toggle('dialog-open', Boolean(state.modal));
  const focusCounts = new Map();
  app.querySelectorAll('button').forEach((element) => {
    const base = [element.dataset.action || element.dataset.screen || 'button', element.dataset.room || '', element.dataset.date || ''].join(':');
    const count = focusCounts.get(base) || 0;
    element.dataset.focusKey = `${base}:${count}`;
    focusCounts.set(base, count + 1);
  });
  if (state.modal) {
    app.querySelector('.app-shell').inert = true;
    (app.querySelector('[autofocus]') || app.querySelector('.dialog [data-action="modal-close"]') || app.querySelector('.dialog'))?.focus();
  } else if (focusSelector) {
    app.querySelector(focusSelector)?.focus({ preventScroll: true });
  } else if (focusHeading) {
    app.querySelector('h1')?.focus({ preventScroll: true });
  }
  if (scrollTop) window.scrollTo({ top: 0, behavior: 'instant' });
  if (parent !== window) parent.postMessage({ type: 'breadloaf-preview-ready', screen: state.screen, concept }, location.origin);
}
function navigate(screen) {
  if (!screens.includes(screen)) {
    openModal({ type: 'feature', feature: { guide: 'Guide', board: 'Board', family: 'Family', more: 'All Tools' }[screen] || screen });
    return;
  }
  state.screen = screen;
  state.modal = null;
  state.notice = '';
  const url = new URL(location.href);
  url.searchParams.set('concept', concept);
  url.searchParams.set('screen', screen);
  history.replaceState(null, '', url);
  render({ focusHeading: true, scrollTop: true });
}
function focusKey(element) {
  if (!element) return null;
  if (element.id) return `#${CSS.escape(element.id)}`;
  if (element.dataset?.focusKey) return `[data-focus-key="${CSS.escape(element.dataset.focusKey)}"]`;
  for (const key of ['action', 'screen']) {
    if (element.dataset?.[key]) {
      let selector = `[data-${key}="${CSS.escape(element.dataset[key])}"]`;
      if (element.dataset.room) selector += `[data-room="${CSS.escape(element.dataset.room)}"]`;
      if (element.dataset.date) selector += `[data-date="${CSS.escape(element.dataset.date)}"]`;
      return selector;
    }
  }
  return null;
}
function openModal(modal) {
  previousFocus = focusKey(document.activeElement);
  state.modal = modal;
  render();
}
function closeModal() {
  state.modal = null;
  render({ focusSelector: previousFocus });
}
function chatSend(message) {
  const text = message.trim().slice(0, 500);
  if (!text) return;
  const next = [...state.stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
  let response = 'This is a design preview, so I’m using a few sample replies. Try asking who’s coming next, adding a document, or checking your background tasks. You can also open each page directly.';
  if (/visit|coming|date|stay|calendar/i.test(text)) response = `${next.guest} are next on the sample calendar: ${dateLabel(next.checkIn)}–${dateLabel(next.checkOut)}, in ${roomName(next.room)}. Open Dates below to see the month or add your own sample visit.`;
  else if (/document|upload|archive|file/i.test(text)) response = 'Open Add to Archive to try a sample document. Choose Upload & Analyze to see a result right away, or Analyze in background to save the original and carry on. You can follow its progress in Bucky’s tasks.';
  else if (/task|background|progress/i.test(text)) response = `Your sample document is ${state.task.state === 'complete' ? 'ready to review' : state.task.state === 'error' ? 'waiting for you to retry analysis' : state.task.state === 'running' ? 'being analyzed' : state.task.state === 'undone' ? 'saved with its analysis undone' : 'waiting for background analysis'}. Open Bucky’s tasks to explore what happens next.`;
  state.messages.push({ role: 'user', text }, { role: 'assistant', text: response });
  render({ focusSelector: '#chat-input' });
  app.querySelector('.chat-messages')?.scrollTo({ top: 100000, behavior: 'smooth' });
}

app.addEventListener('click', (event) => {
  const screenTarget = event.target.closest('[data-screen]');
  if (screenTarget) return navigate(screenTarget.dataset.screen);
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const targetFocus = focusKey(target);
  if (action === 'stay-open') return openModal({ type: 'stay', room: target.dataset.room || '' });
  if (action === 'modal-close') return closeModal();
  if (action === 'preview-feature') return openModal({ type: 'feature', feature: target.dataset.feature });
  if (action === 'preview-original') return openModal({ type: 'original' });
  if (action === 'file-choose') return app.querySelector('#archive-file')?.click();
  if (action === 'sample-file') {
    state.selectedFile = { name: 'Autumn maintenance notes.pdf', size: 186400, sample: true };
    state.uploadState = 'preview';
    return render({ focusSelector: '#uploaded-by' });
  }
  if (action === 'upload-reset') {
    state.selectedFile = null;
    state.uploadState = 'select';
    return render({ focusSelector: '[data-action="file-choose"]' });
  }
  if (action === 'upload-background' || action === 'upload-now') {
    state.task = { ...state.task, filename: state.selectedFile.name, state: action === 'upload-now' ? 'complete' : 'waiting', mode: action === 'upload-now' ? 'immediate' : 'background' };
    state.uploadState = action === 'upload-now' ? 'complete' : 'saved';
    return render({ focusHeading: true });
  }
  if (action === 'chat-suggestion') return chatSend(target.dataset.prompt);
  if (action === 'month-prev' || action === 'month-next') {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + (action === 'month-prev' ? -1 : 1), 1);
    state.selectedDay = toISO(state.month);
  } else if (action === 'select-day') state.selectedDay = target.dataset.date;
  else if (action === 'view-month') state.calendarView = 'month';
  else if (action === 'view-list') state.calendarView = 'list';
  else if (action === 'task-progress') state.task.state = state.task.state === 'waiting' ? 'running' : state.task.state === 'running' ? 'complete' : 'waiting';
  else if (action === 'task-error') state.task.state = 'error';
  else if (action === 'task-retry') state.task.state = 'waiting';
  else if (action === 'task-undo') state.task.state = 'undone';
  else if (action === 'notice-dismiss') state.notice = '';
  else return;
  render({ focusSelector: app.querySelector(targetFocus) ? targetFocus : null });
  if (!document.activeElement || document.activeElement === document.body) (app.querySelector('[data-action="task-progress"]') || app.querySelector('h1'))?.focus({ preventScroll: true });
});
app.addEventListener('input', (event) => {
  if (event.target.id === 'uploaded-by') state.uploadedBy = event.target.value;
  if (event.target.id === 'check-in' || event.target.id === 'check-out') app.querySelector('#check-out')?.setCustomValidity('');
});
app.addEventListener('change', (event) => {
  if (event.target.id === 'archive-file') {
    const file = event.target.files?.[0];
    if (!file) return;
    state.selectedFile = { name: file.name, size: file.size, sample: false };
    state.uploadState = 'preview';
    render({ focusSelector: '#uploaded-by' });
  } else if (event.target.id === 'room-date' && event.target.value) {
    state.selectedDay = event.target.value;
    render({ focusSelector: '#room-date' });
  }
});
app.addEventListener('submit', (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.dataset.form === 'chat') return chatSend(new FormData(form).get('message') || '');
  if (form.dataset.form !== 'stay') return;
  const data = new FormData(form);
  const guest = String(data.get('guest') || '').trim();
  const checkIn = String(data.get('checkIn') || '');
  const checkOut = String(data.get('checkOut') || '');
  if (!guest || !checkIn || !checkOut || checkOut <= checkIn) {
    const error = app.querySelector('#stay-error');
    error.hidden = false;
    error.textContent = !guest ? 'Add a name or family for this visit.' : 'The leaving date must be after the arriving date.';
    app.querySelector(!guest ? '#guest-name' : '#check-out')?.focus();
    return;
  }
  state.stays.push({ id: `visit-${state.stays.length + 1}`, guest, checkIn, checkOut, room: String(data.get('room') || ''), status: String(data.get('status') || 'confirmed'), notes: String(data.get('notes') || '').trim() });
  state.selectedDay = checkIn;
  state.month = new Date(parseDate(checkIn).getFullYear(), parseDate(checkIn).getMonth(), 1);
  state.modal = null;
  state.notice = `${guest}’s sample stay is saved for ${dateLabel(checkIn)}–${dateLabel(checkOut)}. The live calendar has not changed.`;
  render({ focusSelector: previousFocus });
});
document.addEventListener('keydown', (event) => {
  if (!state.modal) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
  } else if (event.key === 'Tab') {
    const dialog = app.querySelector('.dialog');
    const focusables = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter((element) => !element.hidden);
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  }
});
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'breadloaf-preview') return;
  if (event.data.reset) state = makeState();
  if (screens.includes(event.data.screen)) navigate(event.data.screen);
  else render({ focusHeading: false, scrollTop: Boolean(event.data.reset) });
});
render();
