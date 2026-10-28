import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AppState, Image, PermissionsAndroid, Platform, Pressable, ScrollView,
  StatusBar, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import LooseOverlay from './modules/loose-overlay';

// ---------------------------------------------------------------- look (Loose Leaf) --
const C = {
  paper: '#edeee3', card: '#f7f6ee', ink: '#1f241f', soft: '#565f52', hint: '#9a9d8f',
  teal: '#1f6f6b', tealDark: '#16514e', line: '#d8d8c8', red: '#a33a3a',
};
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' });
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// Alert.alert does nothing in the browser, so use window.alert / confirm there.
function ask(title, message, buttons) {
  if (Platform.OS !== 'web') { Alert.alert(title, message, buttons); return; }
  const text = title + (message ? '\n\n' + message : '');
  const action = (buttons || []).find((b) => b.onPress);
  if (action && buttons.length > 1) { if (window.confirm(text)) action.onPress(); }
  else window.alert(text);
}

// ---------------------------------------------------------------- helpers --
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const dateKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ''; }
}

function rotFor(id) {   // -3deg .. 3deg, same idea as the web version
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return ((hash % 60) - 30) / 10;
}

/** Same file format as the Loose Leaf web page, so files work in both. */
function buildFile(ideas) {
  const data = {};
  ideas.forEach((i) => { data['idea:' + i.id] = JSON.stringify(i); });
  return JSON.stringify({ app: 'loose-leaf', exportedAt: new Date().toISOString(), data }, null, 2);
}

/** Returns an array of ideas, or null when the file is not a Loose Leaf file. */
function parseFile(text) {
  let payload;
  try { payload = JSON.parse(text); } catch (e) { return null; }
  const data = payload && typeof payload === 'object' && payload.data ? payload.data : payload;
  if (!data || typeof data !== 'object') return null;
  const out = [];
  const take = (idea, fallbackId) => {
    if (!idea || typeof idea !== 'object' || typeof idea.text !== 'string') return;
    if (!idea.id) idea.id = fallbackId;
    if (typeof idea.ts !== 'number') idea.ts = Date.now();
    out.push(idea);
  };
  if (Array.isArray(data)) data.forEach((idea, n) => take(idea, 'imp' + n));
  else {
    Object.entries(data).forEach(([k, v]) => {
      if (typeof v !== 'string' || !k.startsWith('idea:')) return;
      let idea = null;
      try { idea = JSON.parse(v); } catch (e) { /* skip */ }
      take(idea, k.slice(5));
    });
  }
  return out;
}

async function readFile(uri) {
  if (Platform.OS === 'web') return (await fetch(uri)).text();
  return FileSystem.readAsStringAsync(uri);
}

// ---------------------------------------------------------------- one card --
function Card({ idea, onDelete, onSaveEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(idea.text);
  const hasImage = typeof idea.image === 'string' && idea.image.startsWith('data:');
  return (
    <View style={[s.card, { transform: [{ rotate: rotFor(idea.id) + 'deg' }] }]}>
      {hasImage ? <Image source={{ uri: idea.image }} style={s.thumb} resizeMode="cover" /> : null}
      {editing ? (
        <>
          <TextInput
            style={s.editInput}
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
          />
          <View style={s.row}>
            <Pressable onPress={() => { if (draft.trim()) { onSaveEdit(idea.id, draft.trim()); setEditing(false); } }} hitSlop={8}>
              <Text style={s.link}>Save</Text>
            </Pressable>
            <Pressable onPress={() => { setDraft(idea.text); setEditing(false); }} hitSlop={8}>
              <Text style={[s.link, { color: C.soft, marginLeft: 14 }]}>Cancel</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text selectable style={s.cardText}>{idea.text}</Text>
          <Text style={s.cardTime}>{formatTime(idea.ts)}</Text>
          <View style={[s.row, { marginTop: 10 }]}>
            <Pressable onPress={() => { setDraft(idea.text); setEditing(true); }} hitSlop={8}>
              <Text style={s.link}>Edit</Text>
            </Pressable>
            <Pressable onPress={() => onDelete(idea.id)} hitSlop={8}>
              <Text style={[s.link, { color: C.red, marginLeft: 14 }]}>Delete</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- main screen --
function Main() {
  const [ideas, setIdeas] = useState([]);
  const [on, setOn] = useState(false);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState('');
  const [newArmed, setNewArmed] = useState(false);
  const wantOn = useRef(false);        // waiting for the overlay permission
  const statusTimer = useRef(null);
  const armTimer = useRef(null);

  const showStatus = (msg, ms = 4000) => {
    setStatus(msg);
    clearTimeout(statusTimer.current);
    if (ms) statusTimer.current = setTimeout(() => setStatus(''), ms);
  };
  const reload = () => setIdeas(LooseOverlay.getIdeas());

  // ---- floating circle ----
  const askNotifications = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      try { await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS); } catch (e) { /* optional */ }
    }
  };

  const turnOn = useCallback(async () => {
    if (!LooseOverlay.canDrawOverlays()) {
      ask(
        'Allow display over other apps',
        'The floating circle needs the "Display over other apps" permission. Turn it on for Loose, then come back.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => { wantOn.current = true; LooseOverlay.requestOverlayPermission(); } },
        ]
      );
      return;
    }
    await askNotifications();
    const started = !!LooseOverlay.start();
    setOn(started);
    if (!started && LooseOverlay.error()) setStatus('Could not start the circle: ' + LooseOverlay.error());
  }, []);

  const turnOff = useCallback(() => {
    wantOn.current = false;
    LooseOverlay.stop();
    setOn(false);
  }, []);

  // Sync with the native side whenever the app comes back to the front
  // (ideas typed into the circle show up here).
  const refresh = useCallback(() => {
    setIdeas(LooseOverlay.getIdeas());
    if (wantOn.current && LooseOverlay.canDrawOverlays()) {
      wantOn.current = false;
      turnOn();
      return;
    }
    const enabled = LooseOverlay.isEnabled();
    if (enabled && LooseOverlay.canDrawOverlays() && !LooseOverlay.isRunning()) LooseOverlay.start();
    setOn(enabled && LooseOverlay.canDrawOverlays());
  }, [turnOn]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  // ---- ideas ----
  const addIdea = () => {
    const t = text.trim();
    if (!t) return;
    LooseOverlay.addIdea(t);
    setText('');
    reload();
  };

  const deleteIdea = (id) => {
    ask('Delete this idea?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { LooseOverlay.deleteIdea(id); reload(); } },
    ]);
  };

  const saveEdit = (id, newText) => {
    LooseOverlay.setIdeas(LooseOverlay.getIdeas().map((i) => (i.id === id ? { ...i, text: newText } : i)));
    reload();
  };

  // ---- New / Open / Save ----
  const onNew = () => {
    if (!newArmed) {
      setNewArmed(true);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setNewArmed(false), 4000);
      return;
    }
    clearTimeout(armTimer.current);
    setNewArmed(false);
    LooseOverlay.clearIdeas();
    setIdeas([]);
    setFileName('');
    showStatus('New board ✓');
  };

  const onOpen = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets || !res.assets.length) return;
      const asset = res.assets[0];
      showStatus('Opening…', 0);
      const parsed = parseFile(await readFile(asset.uri));
      if (!parsed) { showStatus('Invalid file'); return; }
      if (!parsed.length) { showStatus('Nothing to import'); return; }
      // Merge into the current board, newest first; the opened version wins on a clash.
      const byId = new Map(LooseOverlay.getIdeas().map((i) => [i.id, i]));
      parsed.forEach((i) => byId.set(i.id, i));
      LooseOverlay.setIdeas(Array.from(byId.values()).sort((a, b) => b.ts - a.ts));
      reload();
      setFileName(asset.name || 'file');
      showStatus('Opened ✓ ' + parsed.length + ' idea' + (parsed.length === 1 ? '' : 's') + ' restored', 6000);
    } catch (e) {
      showStatus('Could not open: ' + (e && e.message ? e.message : e), 8000);
    }
  };

  const onSave = async () => {
    const list = LooseOverlay.getIdeas();
    if (!list.length) { showStatus('Nothing to save yet'); return; }
    const name = 'loose-leaf-' + dateKey(new Date()) + '.json';
    const body = buildFile(list);
    try {
      showStatus('Saving…', 0);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const uri = FileSystem.cacheDirectory + name;
        await FileSystem.writeAsStringAsync(uri, body);
        if (!(await Sharing.isAvailableAsync())) { showStatus('Sharing is not available on this phone', 8000); return; }
        await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save Loose Leaf file', UTI: 'public.json' });
      }
      setFileName(name);
      showStatus('Saved ✓');
    } catch (e) {
      showStatus('Save failed: ' + (e && e.message ? e.message : e), 8000);
    }
  };

  if (!LooseOverlay.supported) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.title}>Loose Leaf</Text>
        <Text style={[s.sub, { textAlign: 'center' }]}>
          {Platform.OS === 'android' ? 'The floating circle could not start.' : 'The floating circle only works on Android.'}
        </Text>
        {LooseOverlay.error() ? <Text selectable style={[s.small, { textAlign: 'center', marginTop: 12, color: C.red }]}>{LooseOverlay.error()}</Text> : null}
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.paper} />
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.eyebrow}>LOOSE LEAF</Text>
        <Text style={s.title}>Write it down before it's gone.</Text>
        <Text style={s.sub}>One box. No folders, no tags. Just catch the idea while it's still warm.</Text>

        {/* floating circle switch */}
        <View style={s.circleRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.circleTitle}>Floating circle</Text>
            <Text style={s.small}>{on ? 'On: tap the circle from any app to type an idea' : 'Off: the circle is hidden'}</Text>
          </View>
          <Switch
            value={on}
            onValueChange={(v) => (v ? turnOn() : turnOff())}
            trackColor={{ false: C.line, true: C.teal }}
            thumbColor={C.card}
          />
        </View>

        {/* toolbar: New / Open / Save */}
        <View style={s.toolbar}>
          <Pressable onPress={onNew} style={[s.toolBtn, newArmed && s.toolBtnArmed]}>
            <Text style={[s.toolText, newArmed && { color: C.tealDark }]}>{newArmed ? 'Sure? tap again' : '＋ New'}</Text>
          </Pressable>
          <Pressable onPress={onOpen} style={s.toolBtn}><Text style={s.toolText}>Open</Text></Pressable>
          <Pressable onPress={onSave} style={s.toolBtn}><Text style={s.toolText}>Save</Text></Pressable>
          {fileName ? <Text style={s.badge} numberOfLines={1}>{fileName}</Text> : null}
        </View>
        {status ? <Text selectable style={s.status}>{status}</Text> : null}

        {/* composer */}
        <View style={s.composer}>
          <TextInput
            style={s.composerInput}
            value={text}
            onChangeText={setText}
            placeholder="What's the idea?"
            placeholderTextColor={C.hint}
            multiline
          />
          <View style={s.composerRow}>
            <Text style={s.hint}>saved on this phone</Text>
            <Pressable onPress={addIdea} disabled={!text.trim()} style={[s.saveBtn, !text.trim() && { opacity: 0.4 }]}>
              <Text style={s.saveBtnText}>Save</Text>
            </Pressable>
          </View>
        </View>

        <Text style={s.count}>
          {ideas.length ? ideas.length + ' idea' + (ideas.length === 1 ? '' : 's') + ' on the board' : ''}
        </Text>

        {ideas.length === 0 ? (
          <Text style={s.empty}>Nothing here yet. Type an idea above and press save, or turn on the circle and write from any app. It'll land right here.</Text>
        ) : (
          <View style={s.board}>
            {ideas.map((i) => <Card key={i.id} idea={i} onDelete={deleteIdea} onSaveEdit={saveEdit} />)}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const shadow = { shadowColor: '#1f241f', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 };

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { paddingHorizontal: 20, paddingTop: (StatusBar.currentHeight || 24) + 24, paddingBottom: 60 },
  eyebrow: { fontFamily: MONO, fontSize: 12, letterSpacing: 1.6, color: C.tealDark, marginBottom: 6 },
  title: { fontFamily: SERIF, fontWeight: '600', fontSize: 34, lineHeight: 38, color: C.ink, marginBottom: 8 },
  sub: { color: C.soft, fontSize: 15, lineHeight: 21, marginBottom: 20 },
  small: { color: C.soft, fontSize: 12.5, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center' },

  circleRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 4, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 16,
  },
  circleTitle: { color: C.ink, fontSize: 15, fontWeight: '600', marginBottom: 2 },

  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
  toolBtn: { borderColor: C.line, borderWidth: 1, borderRadius: 3, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 8 },
  toolBtnArmed: { borderColor: C.teal, backgroundColor: 'rgba(31,111,107,0.08)' },
  toolText: { fontFamily: MONO, fontSize: 12, color: C.ink },
  badge: {
    fontFamily: MONO, fontSize: 10.5, color: C.tealDark, borderColor: C.teal, borderWidth: 1, borderRadius: 3,
    paddingVertical: 3, paddingHorizontal: 8, marginBottom: 8, maxWidth: 190,
  },
  status: { fontFamily: MONO, fontSize: 11, color: C.soft, marginBottom: 10 },

  composer: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 4, padding: 16, marginTop: 8, marginBottom: 28, ...shadow },
  composerInput: { fontFamily: SERIF, fontSize: 19, lineHeight: 27, color: C.ink, minHeight: 64, textAlignVertical: 'top', padding: 0 },
  composerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed',
  },
  hint: { fontFamily: MONO, fontSize: 11.5, color: C.hint },
  saveBtn: { backgroundColor: C.teal, borderRadius: 3, paddingVertical: 9, paddingHorizontal: 20 },
  saveBtnText: { color: C.card, fontWeight: '600', fontSize: 14 },

  count: { fontFamily: MONO, fontSize: 12, color: C.soft, marginBottom: 16 },
  empty: { color: C.soft, fontStyle: 'italic', fontSize: 14, lineHeight: 20 },
  board: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48%', backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 3,
    padding: 14, marginBottom: 20, ...shadow,
  },
  cardText: { fontFamily: SERIF, fontSize: 16, lineHeight: 23, color: C.ink, marginBottom: 10 },
  cardTime: { fontFamily: MONO, fontSize: 10.5, color: C.soft },
  thumb: { width: '100%', height: 110, borderRadius: 4, borderWidth: 1, borderColor: C.line, marginBottom: 10 },
  editInput: {
    fontFamily: SERIF, fontSize: 16, lineHeight: 22, color: C.ink, borderColor: C.teal, borderWidth: 1,
    borderRadius: 3, padding: 8, minHeight: 70, textAlignVertical: 'top', marginBottom: 10, backgroundColor: C.paper,
  },
  link: { color: C.teal, fontWeight: '700', fontSize: 13 },
});

// Shows any crash on screen instead of silently closing the app.
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <ScrollView style={s.root} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
          <Text style={s.title}>Loose hit an error</Text>
          <Text selectable style={{ color: C.red, fontSize: 13 }}>{String(this.state.error && (this.state.error.stack || this.state.error.message || this.state.error))}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <Boundary>
      <Main />
    </Boundary>
  );
}
