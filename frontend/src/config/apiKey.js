// Anthropic key kept only in the browser session (base64 obfuscated, never
// rendered). Sent per request in the x-anthropic-key header over HTTPS.
const KEY_STORE = 'aidj_key';

export const loadKey = () => { try { return atob(sessionStorage.getItem(KEY_STORE) || ''); } catch { return ''; } };
export const saveKey = (k) => { try { k ? sessionStorage.setItem(KEY_STORE, btoa(k)) : sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ } };
export const keyHeader = () => { const k = loadKey().trim(); return k ? { 'x-anthropic-key': k } : {}; };
