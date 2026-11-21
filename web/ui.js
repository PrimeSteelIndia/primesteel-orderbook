/* Shared UI helpers: icons, formatting, toasts, sheets, API access. */
'use strict';

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
  'chevron-right': '<path d="M9 18l6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  share: '<path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 14v5a1 1 0 001 1h14a1 1 0 001-1v-5"/>',
  whatsapp: '<path d="M12 3a9 9 0 00-7.7 13.6L3 21l4.5-1.2A9 9 0 1012 3z"/><path d="M8.8 8.4c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2 0 .4-.1.5l-.4.5c-.1.1-.2.3 0 .5.4.7 1.1 1.4 1.9 1.8.2.1.4.1.5 0l.5-.5c.1-.2.3-.2.5-.1l1.6.7c.3.1.4.2.4.4v.5c0 .3-.1.6-.3.8-.4.5-1.1.8-1.8.7-1.6-.2-3.2-1.1-4.4-2.4-1.2-1.2-2-2.7-2.1-4.1 0-.6.2-1.1.5-1.4z"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  scale: '<path d="M12 3v18M7 7l-4 7h8L7 7zM17 7l-4 7h8L17 7z"/><path d="M8 21h8"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  refresh: '<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
  wifi: '<path d="M5 12.5a10 10 0 0114 0M8.5 16a5.5 5.5 0 017 0"/><path d="M2 9a15 15 0 0120 0"/><circle cx="12" cy="20" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  package: '<path d="M16 4l4 2v12l-8 4-8-4V6l4-2"/><path d="M4 6l8 4 8-4M12 10v12"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
};

function icon(name, cls = 'i') {
  const body = ICONS[name] || ICONS.box;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function money(n) {
  const v = Number(n) || 0;
  return '₹' + inr.format(Math.round(v * 100) / 100);
}

function moneyShort(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return '₹' + inr.format(v);
}

function kg(n, dp = 1) {
  const v = Number(n) || 0;
  if (!v) return '0 kg';
  const fixed = v.toFixed(dp);
  return (fixed.endsWith('.0') && dp === 1 ? fixed.slice(0, -2) : fixed) + ' kg';
}

function unitQty(n, unit = 'pcs', dp = 2) {
  const v = Number(n) || 0;
  const fixed = (v % 1 === 0) ? String(v) : v.toFixed(dp).replace(/\.?0+$/, '');
  return `${fixed} ${unit || 'pcs'}`;
}

function num(n) {
  return (Number(n) || 0).toLocaleString('en-IN');
}

function timeAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 45000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' h ago';
  return Math.floor(diff / 86400000) + ' d ago';
}

function clockTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? 'Today' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// "Prime Steel" -> "PS". Keeps the header badge in step with whatever company
// name is configured instead of a hardcoded pair of letters.
function brandInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem('ps.' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('ps.' + key, JSON.stringify(value)); } catch { /* full */ }
  },
  del(key) {
    try { localStorage.removeItem('ps.' + key); } catch { /* ignore */ }
  },
};

class ApiFailure extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let ADMIN_PIN = '';
let WORKER_PIN = '';

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (ADMIN_PIN) headers['X-Admin-Pin'] = ADMIN_PIN;
  if (WORKER_PIN) headers['X-Worker-Pin'] = WORKER_PIN;
  let res;
  try {
    res = await fetch(path, { ...options, headers });
  } catch (err) {
    // Retry once after 800ms in case the server was waking up or network blipped
    try {
      await new Promise(r => setTimeout(r, 800));
      res = await fetch(path, { ...options, headers });
    } catch {
      throw new ApiFailure('Cannot reach the server. Please check connection and try again.', 0);
    }
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    throw new ApiFailure((data && data.error) || `Request failed (${res.status})`, res.status);
  }
  return data;
}

/* ---------- toast ---------- */
function toast(message, type = '') {
  let root = $('#toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    document.body.appendChild(root);
  }
  const node = document.createElement('div');
  node.className = 'toast ' + type;
  node.innerHTML = (type === 'error' ? icon('alert') : type === 'success' ? icon('check') : '') +
    `<span>${esc(message)}</span>`;
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity 200ms, transform 200ms';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, 2900);
}

/* ---------- bottom sheet ---------- */
let activeSheet = null;

function closeSheet() {
  if (!activeSheet) return;
  activeSheet.backdrop.remove();
  activeSheet.sheet.remove();
  activeSheet = null;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', escClose);
}

function openSheet({ title = '', sub = '', body = '', actions = '', onMount, dense = false }) {
  closeSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    ${title ? `<div class="sheet-head">
      <div style="flex:1;min-width:0">
        <div class="sheet-title">${esc(title)}</div>
        ${sub ? `<div class="sheet-sub">${esc(sub)}</div>` : ''}
      </div>
      <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
    </div>` : ''}
    <div class="sheet-body">${body}</div>
    ${actions ? `<div class="sheet-actions">${actions}</div>` : ''}
  `;
  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  document.body.style.overflow = 'hidden';
  backdrop.addEventListener('click', closeSheet);
  $$('[data-close]', sheet).forEach(b => b.addEventListener('click', closeSheet));
  document.addEventListener('keydown', escClose);
  activeSheet = { backdrop, sheet, dense };
  if (onMount) {
    // Defer so callers can destructure `{ sheet, close }` first — running onMount
    // synchronously makes any reference to `close` throw a TDZ error and silently
    // break every save/edit handler in the sheet.
    queueMicrotask(() => { if (activeSheet && activeSheet.sheet === sheet) onMount(sheet); });
  }
  const focusTarget = sheet.querySelector('input, button:not([data-close])');
  return { sheet, close: closeSheet };
}

function escClose(e) {
  if (e.key === 'Escape') {
    closeSheet();
    document.removeEventListener('keydown', escClose);
  }
}

function confirmSheet({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const { sheet } = openSheet({
      title,
      body: `<p class="muted" style="font-size:15px;line-height:1.55;margin-bottom:4px">${esc(message)}</p>`,
      actions: `
        <button class="btn btn-block" data-cancel style="flex:1">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-ok style="flex:1">${esc(confirmText)}</button>`,
    });
    sheet.querySelector('[data-cancel]').addEventListener('click', () => { closeSheet(); resolve(false); });
    sheet.querySelector('[data-ok]').addEventListener('click', () => { closeSheet(); resolve(true); });
  });
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
    } catch (e) { reject(e); }
    ta.remove();
  });
}

function parseNumber(value) {
  const cleaned = String(value ?? '').replace(/[₹,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function downloadFrom(path, filename) {
  const headers = {};
  if (ADMIN_PIN) headers['X-Admin-Pin'] = ADMIN_PIN;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiFailure(msg, res.status);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename\*=UTF-8''([^;]+)/);
  const name = match ? decodeURIComponent(match[1]) : filename;
  downloadBlob(blob, name);
}
