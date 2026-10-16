'use strict';

const { queryOccurrenceElement } = require('./shadowDom');

/**
 * What the screenshots step does in one frame, one request at a time. Runs
 * in the page and uses nothing from outside its own body except `query`
 * (queryOccurrenceElement), which screenshotInPage below embeds, so a driver
 * can send it as it sends core's scan.
 *
 * A request that changes what the page shows (a scroll, the overlay)
 * resolves once the browser has painted it, so a screenshot taken next
 * shows it; every driver's evaluate waits for a returned Promise.
 *
 * Every change it makes to the page is undone by `release` with the same
 * token: the overlay it draws and the scroll positions it changes, kept
 * under a symbol on the window in between. A request that throws undoes
 * its own changes first.
 *
 * Requests (`request.op`):
 * - `frame-key`, in a parent frame: names the <iframe> leading to the
 *   scanned frame, as `{ key }`.
 * - `hold`, in a parent frame: keeps that <iframe>'s scroll positions, and
 *   scrolls it into view when it isn't. Returns `{ key }`.
 * - `target`, in the scanned frame: finds the element, keeps its scroll
 *   positions, scrolls it into view when it isn't, draws the overlay, and
 *   returns where it is, or `{ skipped }` when it can't be pictured or is
 *   the whole page.
 * - `reveal`, in a parent frame: scrolls the window so that `request.rect`,
 *   the element's box in the <iframe>'s own viewport, shows with
 *   `request.margin` around it, and returns where that viewport sits in
 *   this frame's.
 * - `release`, anywhere: undoes what `hold` or `target` did.
 *
 * `element`, when given, is the <iframe> as a driver's element handle,
 * in place of `request.iframe`.
 */
function screenshotStep(request, element, query) {
  const STATE = Symbol.for('surea11y.screenshots');
  // The space the highlight takes around the element, in CSS pixels: a
  // white line, two of colour and a white line, so it shows on any
  // background. Outside the element, so none of its own pixels change.
  const RING = 4;

  function states() {
    if (!Object.prototype.hasOwnProperty.call(window, STATE)) {
      Object.defineProperty(window, STATE, { value: new Map(), configurable: true });
    }
    return window[STATE];
  }

  // Resolves once the browser has painted what was just changed: two
  // animation frames, the second starting after the first was presented.
  // So a driver whose screenshot doesn't wait for the next frame itself
  // still shows the scroll and the overlay. A tab in the background runs
  // no animation frames, so the wait is capped.
  function painted() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 250);
    });
  }

  function rectOf(r) {
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  // The frame's viewport without its scroll bars, which a screenshot shows
  // but no element is drawn under.
  function viewport() {
    const root = document.compatMode === 'BackCompat' && document.body ? document.body : document.documentElement;
    const width = root && root.clientWidth ? root.clientWidth : window.innerWidth;
    const height = root && root.clientHeight ? root.clientHeight : window.innerHeight;
    return { x: 0, y: 0, width, height };
  }

  function view() {
    return {
      viewport: viewport(),
      window: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio || 1,
      scroll: { x: window.scrollX || 0, y: window.scrollY || 0 }
    };
  }

  // The element's parent in the flat tree: its slot, its parent, or the host
  // of the shadow root it is the top of.
  function parentOf(node) {
    if (node.assignedSlot) return node.assignedSlot;
    if (node.parentElement) return node.parentElement;
    const parent = node.parentNode;
    return parent && parent.host ? parent.host : null;
  }

  function ancestors(node) {
    const list = [];
    for (let n = parentOf(node); n; n = parentOf(n)) list.push(n);
    return list;
  }

  // Whether the rectangle shows whole: inside the viewport and inside every
  // ancestor that clips what overflows it.
  function shows(node, r) {
    const within = (outer) => r.x >= outer.x - 0.5 && r.y >= outer.y - 0.5 &&
      r.x + r.width <= outer.x + outer.width + 0.5 && r.y + r.height <= outer.y + outer.height + 0.5;
    if (!within(viewport())) return false;
    for (const a of ancestors(node)) {
      if (a === document.documentElement || a === document.body) continue;
      const style = getComputedStyle(a);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const box = a.getBoundingClientRect();
      if (!within({ x: box.left + a.clientLeft, y: box.top + a.clientTop, width: a.clientWidth, height: a.clientHeight })) return false;
    }
    return true;
  }

  function scrollTo(target, left, top) {
    try {
      target.scrollTo({ left, top, behavior: 'instant' });
    } catch (e) {
      target.scrollTo(left, top);
    }
  }

  // Into view, on each axis centered when the element fits and from its
  // start when it doesn't; at once, whatever the page's scroll-behavior.
  // Decided by the element's own box: padding is context, and an element as
  // wide as the viewport is still centered from top to bottom.
  function scrollIntoView(node, r) {
    if (typeof node.scrollIntoView !== 'function') return;
    const v = viewport();
    const options = { block: r.height <= v.height ? 'center' : 'start', inline: r.width <= v.width ? 'center' : 'start' };
    try {
      node.scrollIntoView({ ...options, behavior: 'instant' });
    } catch (e) {
      node.scrollIntoView(options);
    }
  }

  // Keeps the scroll positions a scroll into view could change: every
  // ancestor that has something to scroll, and the window.
  function keep(token, node) {
    const scrolls = [];
    for (const a of ancestors(node)) {
      if (a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth) scrolls.push([a, a.scrollLeft, a.scrollTop]);
    }
    const state = { scrolls, window: [window.scrollX || 0, window.scrollY || 0], overlay: null };
    states().set(token, state);
    return state;
  }

  function release(token) {
    const all = window[STATE];
    const state = all && all.get(token);
    if (!state) return true;
    all.delete(token);
    if (!all.size) delete window[STATE];
    if (state.overlay) {
      try {
        if (typeof state.overlay.hidePopover === 'function' && state.overlay.matches(':popover-open')) state.overlay.hidePopover();
      } catch (e) {}
      state.overlay.remove();
    }
    for (let i = state.scrolls.length - 1; i >= 0; i--) {
      const [node, left, top] = state.scrolls[i];
      if (node.scrollLeft !== left || node.scrollTop !== top) {
        try {
          scrollTo(node, left, top);
        } catch (e) {}
      }
    }
    const [x, y] = state.window;
    if ((window.scrollX || 0) !== x || (window.scrollY || 0) !== y) scrollTo(window, x, y);
    return true;
  }

  // An outline drawn over the page around the element, never a style on the
  // element itself, which could change the contrast being reported. In the
  // top layer where the browser has one, so it shows above a modal dialog
  // too, and at the highest z-index otherwise.
  function drawOverlay(state, r) {
    const overlay = document.createElement('surea11y-highlight');
    const set = (name, value) => overlay.style.setProperty(name, value, 'important');
    set('all', 'initial');
    set('display', 'block');
    set('position', 'fixed');
    set('box-sizing', 'border-box');
    set('margin', '0');
    set('padding', '0');
    set('inset', 'auto');
    set('left', `${r.x - RING + 1}px`);
    set('top', `${r.y - RING + 1}px`);
    set('width', `${r.width + 2 * (RING - 1)}px`);
    set('height', `${r.height + 2 * (RING - 1)}px`);
    set('border', '2px solid #e5007d');
    set('box-shadow', '0 0 0 1px #ffffff, inset 0 0 0 1px #ffffff');
    set('background', 'transparent');
    set('overflow', 'visible');
    set('z-index', '2147483647');
    set('pointer-events', 'none');
    set('opacity', '1');
    set('visibility', 'visible');
    overlay.setAttribute('aria-hidden', 'true');
    const topLayer = typeof overlay.showPopover === 'function';
    if (topLayer) overlay.setAttribute('popover', 'manual');
    state.overlay = overlay;
    document.documentElement.appendChild(overlay);
    if (topLayer) {
      try {
        overlay.showPopover();
      } catch (e) {}
    }
    // A transform on <html> moves what is fixed: put it where it was meant.
    const drawn = overlay.getBoundingClientRect();
    const dx = r.x - RING + 1 - drawn.left;
    const dy = r.y - RING + 1 - drawn.top;
    if (Math.abs(dx) > 0.01) set('left', `${r.x - RING + 1 + dx}px`);
    if (Math.abs(dy) > 0.01) set('top', `${r.y - RING + 1 + dy}px`);
  }

  // The <iframe> leading to the scanned frame: a driver's handle to it, a
  // CSS selector, or the index among the elements a selector matches (the
  // way Selenium and WebdriverIO walk frames).
  function iframeOf() {
    let frame = element || null;
    const at = request.iframe;
    if (!frame && typeof at === 'string') frame = document.querySelector(at);
    if (!frame && at && typeof at.index === 'number') frame = document.querySelectorAll(at.selector || 'iframe, frame')[at.index] || null;
    if (!frame || frame.nodeType !== 1 || !/^i?frame$/i.test(frame.localName)) {
      throw new Error(`the <iframe> leading to the frame is not in its parent document (${JSON.stringify(at === undefined ? null : at)})`);
    }
    return frame;
  }

  // The <iframe> as core names a frame element: its id when no other
  // element has it, else its path by type, inside its shadow hosts.
  function keyOf(node) {
    const escape = (s) => (typeof CSS === 'object' && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, (c) => `\\${c}`));
    const root = node.getRootNode();
    let key;
    if (node.id && root.querySelectorAll(`#${escape(node.id)}`).length === 1) {
      key = `#${escape(node.id)}`;
    } else {
      const parts = [];
      for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
        let index = 1;
        for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === n.localName) index += 1;
        let more = index > 1;
        for (let s = n.nextElementSibling; s && !more; s = s.nextElementSibling) if (s.localName === n.localName) more = true;
        parts.unshift(more ? `${n.localName}:nth-of-type(${index})` : n.localName);
      }
      key = parts.join(' > ');
    }
    return root.host ? `${keyOf(root.host)} >>> ${key}` : key;
  }

  // Where the <iframe>'s viewport sits in this frame's: inside its border
  // and padding, scaled by any transform.
  function placement(frame) {
    const r = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    const scaleX = frame.offsetWidth ? r.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight ? r.height / frame.offsetHeight : 1;
    return {
      origin: {
        x: r.left + (frame.clientLeft + (parseFloat(style.paddingLeft) || 0)) * scaleX,
        y: r.top + (frame.clientTop + (parseFloat(style.paddingTop) || 0)) * scaleY
      },
      scale: { x: scaleX, y: scaleY }
    };
  }

  switch (request.op) {
    case 'frame-key':
      return { key: keyOf(iframeOf()) };

    case 'hold': {
      const frame = iframeOf();
      keep(request.token, frame);
      try {
        const r = rectOf(frame.getBoundingClientRect());
        if (shows(frame, r)) return { key: keyOf(frame) };
        scrollIntoView(frame, r);
        return painted().then(() => ({ key: keyOf(frame) }));
      } catch (e) {
        release(request.token);
        throw e;
      }
    }

    case 'target': {
      const node = query(request.selector, request.shadowHostSelectors);
      if (!node) return { skipped: 'no-element' };
      // A finding about the whole page, reported on <html>, <head> or
      // <body>: a picture of the viewport would show nothing of it.
      if (node === document.documentElement || node === document.head || node === document.body) return { skipped: 'page-level' };
      if (!node.getClientRects().length) return { skipped: 'not-rendered' };
      const before = rectOf(node.getBoundingClientRect());
      if (!(before.width > 0) || !(before.height > 0)) return { skipped: 'zero-size' };
      const state = keep(request.token, node);
      try {
        const margin = request.margin || 0;
        const padded = { x: before.x - margin, y: before.y - margin, width: before.width + 2 * margin, height: before.height + 2 * margin };
        if (!shows(node, padded)) scrollIntoView(node, before);
        const r = rectOf(node.getBoundingClientRect());
        if (request.highlight) drawOverlay(state, r);
        return painted().then(() => ({ rect: r, ...view() }));
      } catch (e) {
        release(request.token);
        throw e;
      }
    }

    case 'reveal': {
      const frame = iframeOf();
      const at = request.rect;
      const margin = request.margin || 0;
      const place = placement(frame);
      const r = {
        x: place.origin.x + at.x * place.scale.x,
        y: place.origin.y + at.y * place.scale.y,
        width: at.width * place.scale.x,
        height: at.height * place.scale.y
      };
      const v = viewport();
      const shown = r.x - margin >= -0.5 && r.y - margin >= -0.5 &&
        r.x + r.width + margin <= v.width + 0.5 && r.y + r.height + margin <= v.height + 0.5;
      if (!shown) {
        // On each axis centered when the element fits, from its start when
        // it doesn't, as the scanned frame's own scroll into view does.
        const dx = r.width <= v.width ? r.x + r.width / 2 - v.width / 2 : r.x;
        const dy = r.height <= v.height ? r.y + r.height / 2 - v.height / 2 : r.y;
        scrollTo(window, (window.scrollX || 0) + dx, (window.scrollY || 0) + dy);
        return painted().then(() => ({ ...placement(frame), ...view() }));
      }
      return { ...place, ...view() };
    }

    case 'release':
      return release(request.token);

    default:
      throw new Error(`unknown screenshot step ${JSON.stringify(request.op)}`);
  }
}

/**
 * screenshotStep with queryOccurrenceElement inside it, as one function a
 * driver can serialize: `screenshotInPage(request, element?)`. Built from
 * their sources, as createInPageScan() builds core's scan.
 */
// eslint-disable-next-line no-new-func
const screenshotInPage = new Function(
  'return (function surea11yScreenshotStep(request, element) {\n' +
  '  const query = (' + queryOccurrenceElement.toString() + ');\n' +
  '  return (' + screenshotStep.toString() + ')(request, element, query);\n' +
  '})'
)();

module.exports = { screenshotInPage, HIGHLIGHT_SPACE: 4 };
