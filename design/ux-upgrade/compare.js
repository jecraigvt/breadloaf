const concepts = {
  cabin: { name: 'Refined Cabin', description: 'The gentlest transition: the familiar editorial character, made more consistent and easier to use.' },
  fieldguide: { name: 'Family Field Guide', description: 'The most expressive direction: photography and editorial chapters make the property feel close, wherever you are.' },
  homestead: { name: 'Modern Homestead', description: 'A calm daily home base: a shorter introduction, clear panels, and the next useful action always within reach.' },
};
const screens = ['hub', 'calendar', 'rooms', 'bucky', 'upload', 'tasks'];
const viewports = { mobile: { width: 390, height: 844 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1440, height: 980 } };
const $ = (selector) => document.querySelector(selector);
const focused = $('#focused-preview');
const comparison = $('#comparison-view');
const exploration = $('#exploration-view');
const state = { mode: 'compare', concept: 'cabin', screen: 'hub', viewport: 'mobile' };
let loadedFocus = '';

function readState() {
  const params = new URLSearchParams(location.search);
  state.mode = params.get('mode') === 'explore' ? 'explore' : 'compare';
  state.concept = Object.hasOwn(concepts, params.get('concept')) ? params.get('concept') : 'cabin';
  state.screen = screens.includes(params.get('screen')) ? params.get('screen') : 'hub';
  state.viewport = Object.hasOwn(viewports, params.get('viewport')) ? params.get('viewport') : 'mobile';
}

function writeState() {
  const url = new URL(location.href);
  url.search = new URLSearchParams(state).toString();
  history.replaceState(null, '', url);
}

function prototypeUrl(concept, screen = state.screen) {
  return `/prototype.html?${new URLSearchParams({ concept, screen })}`;
}

function announce(message) { $('#preview-announcement').textContent = message; }

function sizeFrames() {
  if (state.mode === 'compare') {
    document.querySelectorAll('[data-mini-frame]').forEach((frame) => {
      const width = Math.min(390, frame.parentElement.clientWidth - parseFloat(getComputedStyle(frame.parentElement).paddingLeft) * 2);
      const scale = width / 390;
      frame.style.width = `${width}px`;
      frame.style.height = `${740 * scale}px`;
      frame.querySelector('iframe').style.transform = `scale(${scale})`;
    });
  } else {
    const { width, height } = viewports[state.viewport];
    const stage = $('#focused-stage');
    const availableWidth = stage.clientWidth - parseFloat(getComputedStyle(stage).paddingLeft) * 2;
    const scale = Math.min(1, availableWidth / width);
    const frame = $('#focused-frame');
    frame.style.width = `${width * scale}px`;
    frame.style.height = `${height * scale}px`;
    focused.style.width = `${width}px`;
    focused.style.height = `${height}px`;
    focused.style.transform = `scale(${scale})`;
    $('#scale-label').textContent = `${width} × ${height} · ${scale < .995 ? `Scaled to ${Math.round(scale * 100)}% — open full-size to inspect` : 'Actual size'}`;
  }
}

function update({ reload = false, history = true } = {}) {
  comparison.hidden = state.mode !== 'compare';
  exploration.hidden = state.mode !== 'explore';
  $('#compare-mode').setAttribute('aria-pressed', String(state.mode === 'compare'));
  $('#explore-mode').setAttribute('aria-pressed', String(state.mode === 'explore'));
  $('#screen-select').value = state.screen;
  $('#concept-select').value = state.concept;
  document.querySelectorAll('[data-viewport]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.viewport === state.viewport)));
  if (state.mode === 'compare' && reload) {
    document.querySelectorAll('[data-preview-concept]').forEach((frame) => { frame.src = prototypeUrl(frame.dataset.previewConcept); });
  }
  if (state.mode === 'explore') {
    const target = prototypeUrl(state.concept);
    if (loadedFocus !== target || reload) { focused.src = target; loadedFocus = target; }
  }
  focused.title = `${concepts[state.concept].name} focused interactive preview`;
  $('#active-concept-description').textContent = concepts[state.concept].description;
  $('#full-size-link').href = prototypeUrl(state.concept);
  if (history) writeState();
  requestAnimationFrame(sizeFrames);
}

$('#compare-mode').addEventListener('click', () => { state.mode = 'compare'; update({ reload: true }); });
$('#explore-mode').addEventListener('click', () => { state.mode = 'explore'; update(); });
document.querySelectorAll('[data-explore]').forEach((button) => button.addEventListener('click', () => {
  state.mode = 'explore'; state.concept = button.dataset.explore; update();
  $('.comparison-controls').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  $('#concept-select').focus({ preventScroll: true });
  announce(`Exploring ${concepts[state.concept].name}. Choose a screen or use the interactive preview.`);
}));
$('#screen-select').addEventListener('change', (event) => { state.screen = event.target.value; update({ reload: true }); });
$('#concept-select').addEventListener('change', (event) => { state.concept = event.target.value; update(); });
document.querySelectorAll('[data-viewport]').forEach((button) => button.addEventListener('click', () => { state.viewport = button.dataset.viewport; update(); announce(`${state.viewport} viewport selected.`); }));
$('#reset-flow').addEventListener('click', () => {
  focused.contentWindow?.postMessage({ type: 'breadloaf-preview', screen: state.screen, reset: true }, location.origin);
  announce('This preview has been reset to its sample content.');
});
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || !event.data || event.data.type !== 'breadloaf-preview-ready' || !screens.includes(event.data.screen)) return;
  if (state.mode === 'explore' && event.source === focused.contentWindow && event.data.concept === state.concept) {
    state.screen = event.data.screen;
    loadedFocus = prototypeUrl(state.concept);
    $('#screen-select').value = state.screen;
    $('#full-size-link').href = prototypeUrl(state.concept);
    writeState();
  }
});
window.addEventListener('popstate', () => { readState(); update({ reload: true, history: false }); });
new ResizeObserver(sizeFrames).observe(document.querySelector('main'));
readState();
update({ reload: true });
