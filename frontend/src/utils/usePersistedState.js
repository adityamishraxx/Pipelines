import { useEffect, useState } from 'react';

// State mirrored into localStorage, for per-user view preferences that should
// survive a reload or a round-trip to another page (the app's existing pattern —
// see `sidebarCollapsed` in Sidebar.jsx). /api/settings is a global,
// admin-write-only store and can't hold per-user preferences.
//
// `normalize` runs over whatever was stored before it becomes state, so a
// preference saved by an older build can be repaired rather than trusted blindly.
export default function usePersistedState(storageKey, initial, normalize = (v) => v) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) return normalize(JSON.parse(raw));
    } catch { /* corrupt or unavailable storage — fall through to the default */ }
    return normalize(typeof initial === 'function' ? initial() : initial);
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* quota/private mode — still applies for this session */ }
  }, [storageKey, value]);

  return [value, setValue];
}
