/// <reference types="cypress" />
/**
 * Helpers for narrated training recordings (cypress.training.config.ts).
 *
 *   loadNarration();             // reads TRAINING_NARRATION
 *   startClock();                // a short black frame marks time zero for lining up the voice
 *   line('s3-01', () => { ... }) // actions start as its voice starts; stays on the line until the voice ends
 *                                // Keep each line short and about ONE action, so what is said is what is seen.
 *   tap(() => cy.contains('button', 'Book'));  // moves the visible pointer to the element, then clicks
 *   drag(() => pet, () => card);  // drags with the pointer and a copy of the item
 *   catchNewTabs();               // a link that opens a new tab shows in a browser-style window instead
 *   closeNewTab();
 * Captions are off unless CYPRESS_TRAINING_CAPTIONS=1.
 *   finish();                    // writes the line start times
 */

type Line = { id: string; text: string; ms: number };
const lines: Record<string, Line> = {};
/** Pause after each line's voice before the next one starts. */
const GAP_MS = 700;

export function loadNarration() {
  cy.task<Line[]>('trainingNarration', null, { log: false }).then((all) => {
    all.forEach((l) => (lines[l.id] = l));
  });
}

function overlay(doc: Document, id: string, css: string): HTMLElement {
  let el = doc.getElementById(id);
  if (!el) {
    el = doc.createElement('div');
    el.id = id;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = css;
    doc.body.appendChild(el);
  }
  return el;
}

function caption(text: string) {
  if (!Cypress.env('TRAINING_CAPTIONS')) return;
  cy.document({ log: false }).then((doc) => {
    const el = overlay(
      doc,
      'training-caption',
      [
        'position:fixed',
        'left:50%',
        'bottom:18px',
        'transform:translateX(-50%)',
        'max-width:980px',
        'padding:10px 18px',
        'border-radius:10px',
        'background:rgba(17,24,39,.86)',
        'color:#fff',
        'font:500 17px/1.4 system-ui,-apple-system,sans-serif',
        'text-align:center',
        'z-index:2147483646',
        'pointer-events:none',
      ].join(';')
    );
    el.textContent = text;
  });
}

/** A large arrow cursor (black with a white edge), its tip at left/top. */
function pointer(doc: Document): HTMLElement {
  const el = overlay(
    doc,
    'training-pointer',
    [
      'position:fixed',
      'left:800px',
      'top:450px',
      'width:46px',
      'height:46px',
      'z-index:2147483647',
      'pointer-events:none',
      'filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))',
      'transition:left .55s ease,top .55s ease,transform .15s ease',
      'transform-origin:0 0',
    ].join(';')
  );
  if (!el.firstChild) {
    el.innerHTML =
      '<svg width="46" height="46" viewBox="0 0 24 24"><path d="M3 2 L3 20 L8 15.5 L11.5 22.5 L14.5 21 L11 14 L18 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }
  return el;
}

/** A bright outline around what is about to be clicked or looked at. */
function highlight(doc: Document, r: DOMRect, ms: number) {
  doc.getElementById('training-highlight')?.remove();
  const box = doc.createElement('div');
  box.id = 'training-highlight';
  box.setAttribute('aria-hidden', 'true');
  const pad = 6;
  box.style.cssText = [
    'position:fixed',
    `left:${r.left - pad}px`,
    `top:${r.top - pad}px`,
    `width:${r.width + pad * 2}px`,
    `height:${r.height + pad * 2}px`,
    'border:4px solid #f59e0b',
    'border-radius:10px',
    'box-shadow:0 0 0 4px rgba(245,158,11,.25),0 0 18px rgba(245,158,11,.55)',
    'z-index:2147483645',
    'pointer-events:none',
  ].join(';');
  doc.body.appendChild(box);
  setTimeout(() => box.remove(), ms);
}

/** A ring that grows from the click point. */
function ripple(doc: Document, x: number, y: number) {
  const ring = doc.createElement('div');
  ring.setAttribute('aria-hidden', 'true');
  ring.style.cssText = [
    'position:fixed',
    `left:${x - 8}px`,
    `top:${y - 8}px`,
    'width:16px',
    'height:16px',
    'border-radius:50%',
    'border:4px solid #f59e0b',
    'background:rgba(245,158,11,.45)',
    'z-index:2147483646',
    'pointer-events:none',
    'transition:transform .6s ease-out,opacity .6s ease-out',
  ].join(';');
  doc.body.appendChild(ring);
  requestAnimationFrame(() => {
    ring.style.transform = 'scale(4)';
    ring.style.opacity = '0';
  });
  setTimeout(() => ring.remove(), 750);
}

/** Scrolls the element to the middle of the screen (clear of sticky headers) and yields it. */
function center(get: () => Cypress.Chainable<JQuery<HTMLElement>>) {
  get().then(($el) => $el[0].scrollIntoView({ block: 'center', behavior: 'smooth' }));
  cy.wait(300, { log: false });
  settle(get);
  return get();
}

/** A long smooth scroll can still be moving after 450 ms: wait until the element stops moving (up to ~1 s more). */
function settle(get: () => Cypress.Chainable<JQuery<HTMLElement>>, tries = 0) {
  get().then(($el) => {
    const top = $el[0].getBoundingClientRect().top;
    cy.wait(120, { log: false });
    get().then(($again) => {
      if (Math.abs($again[0].getBoundingClientRect().top - top) > 1 && tries < 8) settle(get, tries + 1);
    });
  });
}

function moveTo(doc: Document, r: DOMRect, highlightMs: number) {
  const p = pointer(doc);
  p.style.left = `${r.left + r.width / 2}px`;
  p.style.top = `${r.top + r.height / 2}px`;
  highlight(doc, r, highlightMs);
}

/** Moves the cursor onto the element and outlines it, then clicks it (dblclick when asked). */
export function tap(get: () => Cypress.Chainable<JQuery<HTMLElement>>, how: 'click' | 'dblclick' = 'click') {
  center(get).then(($el) => {
    moveTo($el[0].ownerDocument, $el[0].getBoundingClientRect(), 2000);
  });
  // The cursor travels for about half a second, then rests on the target so the eye catches up.
  cy.wait(1100, { log: false });
  cy.task('trainingClick', null, { log: false });
  get().then(($el) => {
    const doc = $el[0].ownerDocument;
    const r = $el[0].getBoundingClientRect();
    pointer(doc).style.transform = 'scale(.85)';
    ripple(doc, r.left + r.width / 2, r.top + r.height / 2);
  });
  how === 'dblclick' ? get().dblclick() : get().click();
  cy.wait(250, { log: false });
  cy.document({ log: false }).then((doc) => {
    pointer(doc).style.transform = 'scale(1)';
  });
}

/** Drags `from` onto `to` with the pointer, carrying a copy of the item, then drops it there. */
export function drag(
  from: () => Cypress.Chainable<JQuery<HTMLElement>>,
  to: () => Cypress.Chainable<JQuery<HTMLElement>>
) {
  pointAt(from);
  from().then(($el) => {
    const doc = $el[0].ownerDocument;
    const r = $el[0].getBoundingClientRect();
    const ghost = $el[0].cloneNode(true) as HTMLElement;
    ghost.id = 'training-ghost';
    ghost.style.cssText = [
      'position:fixed',
      `left:${r.left}px`,
      `top:${r.top}px`,
      `width:${r.width}px`,
      `height:${r.height}px`,
      'margin:0',
      'opacity:.85',
      'box-shadow:0 8px 24px rgba(0,0,0,.25)',
      'transform:rotate(-2deg)',
      'z-index:2147483646',
      'pointer-events:none',
      'transition:left .9s ease,top .9s ease',
    ].join(';');
    doc.body.appendChild(ghost);
    pointer(doc).style.transition = 'left .9s ease,top .9s ease,transform .15s ease';
  });
  from().trigger('dragstart', { force: true, log: false });
  cy.wait(250, { log: false });
  center(to).then(($t) => {
    const doc = $t[0].ownerDocument;
    const t = $t[0].getBoundingClientRect();
    const ghost = doc.getElementById('training-ghost');
    const cx = t.left + t.width / 2;
    const cy0 = t.top + Math.min(t.height / 2, 90);
    if (ghost) {
      ghost.style.left = `${cx - ghost.offsetWidth / 2}px`;
      ghost.style.top = `${cy0 - ghost.offsetHeight / 2}px`;
    }
    const p = pointer(doc);
    p.style.left = `${cx}px`;
    p.style.top = `${cy0}px`;
    highlight(doc, t, 1800);
  });
  cy.wait(1000, { log: false });
  cy.task('trainingClick', null, { log: false });
  to().trigger('dragover', { force: true, log: false });
  to().trigger('drop', { force: true, log: false });
  cy.document({ log: false }).then((doc) => {
    doc.getElementById('training-ghost')?.remove();
    pointer(doc).style.transition = 'left .55s ease,top .55s ease,transform .15s ease';
  });
}

/** Moves the cursor onto the element and outlines it for a moment (no click). */
export function pointAt(get: () => Cypress.Chainable<JQuery<HTMLElement>>, outlineMs = 2500) {
  center(get).then(($el) => {
    moveTo($el[0].ownerDocument, $el[0].getBoundingClientRect(), outlineMs);
  });
  cy.wait(800, { log: false });
}

/**
 * Like pointAt, but never scrolls: for things that close when the page scrolls (the schedule's visit pop-up).
 */
export function pointAtInPlace(get: () => Cypress.Chainable<JQuery<HTMLElement>>, outlineMs = 2500) {
  get().then(($el) => {
    moveTo($el[0].ownerDocument, $el[0].getBoundingClientRect(), outlineMs);
  });
  cy.wait(800, { log: false });
}

/**
 * Cypress can't follow a new browser tab, so a page that opens one (window.open) shows it here in a
 * browser-style window over the page instead. The page underneath stays exactly as it was.
 */
export function catchNewTabs() {
  cy.on('window:before:load', (win: Window) => {
    win.open = ((url?: string | URL) => {
      const doc = win.document;
      doc.getElementById('training-tab')?.remove();
      const box = doc.createElement('div');
      box.id = 'training-tab';
      box.style.cssText = [
        'position:fixed',
        'inset:28px 36px',
        'z-index:2147483640',
        'background:#fff',
        'border-radius:12px',
        'overflow:hidden',
        'box-shadow:0 24px 70px rgba(0,0,0,.45)',
        'display:flex',
        'flex-direction:column',
        'border:1px solid #cbd5e1',
      ].join(';');
      const bar = doc.createElement('div');
      bar.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#e2e8f0;font:500 14px system-ui,-apple-system,sans-serif;color:#0f172a';
      bar.innerHTML =
        '<span style="background:#fff;border-radius:8px 8px 0 0;padding:6px 14px">New tab · Scout calendar</span><span style="flex:1"></span>';
      const close = doc.createElement('button');
      close.id = 'training-tab-close';
      close.type = 'button';
      close.textContent = '✕ Close tab';
      close.style.cssText =
        'border:0;background:#fff;border-radius:6px;padding:5px 10px;font:500 13px system-ui,-apple-system,sans-serif;cursor:pointer';
      bar.appendChild(close);
      const frame = doc.createElement('iframe');
      frame.style.cssText = 'flex:1;border:0;width:100%';
      box.appendChild(bar);
      box.appendChild(frame);
      doc.body.appendChild(box);
      const tab = {
        closed: false,
        focus() {},
        close() {
          tab.closed = true;
          box.remove();
        },
        location: {
          get href() {
            return frame.src;
          },
          set href(v: string) {
            frame.src = v;
          },
        },
      };
      close.addEventListener('click', () => tab.close());
      if (url) frame.src = String(url);
      return tab as unknown as Window;
    }) as typeof win.open;
  });
}

export function closeNewTab() {
  tap(() => cy.get('#training-tab-close'));
  cy.get('#training-tab').should('not.exist');
}

/** Types like a person, a little slower than Cypress's default. */
export function typeSlowly(get: () => Cypress.Chainable<JQuery<HTMLElement>>, text: string) {
  center(get).then(($el) => {
    moveTo($el[0].ownerDocument, $el[0].getBoundingClientRect(), 600 + text.length * 50);
  });
  cy.wait(700, { log: false });
  get().type(text, { delay: 45 });
}

export function startClock() {
  // A black frame for 1.2 s; the video is lined up on the moment it disappears.
  cy.document({ log: false }).then((doc) => {
    overlay(doc, 'training-black', 'position:fixed;inset:0;background:#000;z-index:2147483647;pointer-events:none');
  });
  cy.wait(1200, { log: false });
  cy.document({ log: false }).then((doc) => {
    doc.getElementById('training-black')?.remove();
  });
  cy.task('trainingZero', null, { log: false });
  // Where the app sits in Cypress's window, so the video can be cropped to it.
  cy.window({ log: false }).then((win) => {
    const top = win.top!;
    const frame = top.document.querySelector('iframe.aut-iframe') as HTMLIFrameElement | null;
    const r = frame?.getBoundingClientRect();
    if (r) {
      cy.task(
        'trainingFrame',
        { x: r.left, y: r.top, w: r.width, h: r.height, topW: top.innerWidth, topH: top.innerHeight },
        { log: false }
      );
    }
  });
}

/** One narrated line: caption, actions, then wait out the rest of its voice. */
export function line(id: string, actions?: () => void) {
  // Looked up when the line runs, not when the test is queued, so the narration has loaded.
  const get = () => {
    const l = lines[id];
    if (!l) throw new Error(`No narration line ${id}`);
    return l;
  };
  cy.task('trainingMark', id, { log: false });
  cy.then(() => caption(get().text));
  actions?.();
  cy.task<number>('trainingSince', id, { log: false }).then((since) => {
    const rest = get().ms + GAP_MS - since;
    if (rest > 0) cy.wait(rest, { log: false });
  });
}

export function finish() {
  cy.document({ log: false }).then((doc) => doc.getElementById('training-caption')?.remove());
  cy.wait(1500, { log: false });
  cy.task('trainingSave', null, { log: false });
}

/** Picks an option in a dropdown the way tap clicks: cursor, outline, click sound, then the choice. */
export function choose(get: () => Cypress.Chainable<JQuery<HTMLElement>>, value: string) {
  center(get).then(($el) => {
    moveTo($el[0].ownerDocument, $el[0].getBoundingClientRect(), 2000);
  });
  cy.wait(1100, { log: false });
  cy.task('trainingClick', null, { log: false });
  get().then(($el) => {
    const r = $el[0].getBoundingClientRect();
    ripple($el[0].ownerDocument, r.left + r.width / 2, r.top + r.height / 2);
  });
  get().select(value);
  cy.wait(400, { log: false });
}

/**
 * Cut what happens inside `actions` out of the final video (a full page reload, a slow save), so viewers don't
 * sit through dead time. Use it between lines, never inside one: assemble.sh removes the stretch and moves
 * every later voice line and click earlier by the same amount.
 */
export function offCamera(actions: () => void) {
  cy.task('trainingCut', 'start', { log: false });
  actions();
  cy.wait(300, { log: false });
  cy.task('trainingCut', 'end', { log: false });
}
