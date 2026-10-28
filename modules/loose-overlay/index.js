import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

// ---- Android: the real floating circle (native Kotlin module) ----
let Native = null;
let lastError = '';
if (Platform.OS === 'android') {
  try { Native = requireNativeModule('LooseOverlay'); } catch (e) { lastError = 'Native module not found: ' + (e && e.message ? e.message : e); }
}
// Every native call is wrapped so a native error shows on screen instead of closing the app.
const safe = (fn, fallback) => {
  try { return fn(); } catch (e) { lastError = (e && e.message) ? e.message : String(e); return fallback; }
};

// ---- Browser preview: no floating circle on the web, so just remember things in localStorage ----
const isWeb = Platform.OS === 'web';
const get = (k, d) => { try { const v = window.localStorage.getItem('loose_' + k); return v === null ? d : v; } catch (e) { return d; } };
const set = (k, v) => { try { window.localStorage.setItem('loose_' + k, v); } catch (e) { /* ignore */ } };
const webIdeas = () => { try { const a = JSON.parse(get('ideas', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

const web = {
  supported: true,
  error: () => '',
  canDrawOverlays: () => true,
  requestOverlayPermission: () => {},
  start: () => { set('enabled', '1'); return true; },
  stop: () => set('enabled', '0'),
  isEnabled: () => get('enabled', '0') === '1',
  isRunning: () => get('enabled', '0') === '1',
  getIdeas: () => webIdeas(),
  addIdea: (text) => {
    const now = Date.now();
    set('ideas', JSON.stringify([{ id: now.toString(36) + Math.random().toString(36).slice(2, 6), text, ts: now }, ...webIdeas()]));
  },
  setIdeas: (arr) => set('ideas', JSON.stringify(arr)),
  deleteIdea: (id) => set('ideas', JSON.stringify(webIdeas().filter((i) => i.id !== id))),
  clearIdeas: () => set('ideas', '[]'),
};

const android = {
  supported: !!Native,
  error: () => lastError,
  canDrawOverlays: () => safe(() => Native.canDrawOverlays(), false),
  requestOverlayPermission: () => safe(() => Native.requestOverlayPermission(), undefined),
  /** Starts the floating circle. Returns false if the overlay permission is missing. */
  start: () => safe(() => Native.start(), false),
  stop: () => safe(() => Native.stop(), undefined),
  isEnabled: () => safe(() => Native.isEnabled(), false),
  isRunning: () => safe(() => Native.isRunning(), false),
  /** Ideas saved on the phone, newest first: [{ id, text, ts }] */
  getIdeas: () => safe(() => { const a = JSON.parse(Native.getIdeas()); return Array.isArray(a) ? a : []; }, []),
  addIdea: (text) => safe(() => Native.addIdea(text), undefined),
  /** Replaces the whole list with an array of { id, text, ts, image? } */
  setIdeas: (arr) => safe(() => Native.setIdeas(JSON.stringify(arr)), undefined),
  deleteIdea: (id) => safe(() => Native.deleteIdea(id), undefined),
  clearIdeas: () => safe(() => Native.clearIdeas(), undefined),
};

export default isWeb ? web : android;
