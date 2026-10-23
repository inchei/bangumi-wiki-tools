import { PROVIDER_KEY, DEFAULT_PROVIDER, SHOW_KEY } from './config.js';

function hasChiiApp() {
  return typeof chiiApp !== 'undefined' && chiiApp;
}

function get(key, def) {
  if (hasChiiApp()) {
    return chiiApp.cloud_settings.get(key) || def;
  }
  return localStorage.getItem(key) || def;
}

export function getProvider() {
  return get(PROVIDER_KEY, DEFAULT_PROVIDER);
}

export function getShow() {
  return get(SHOW_KEY, 'on');
}

function save(key, val) {
  if (hasChiiApp()) {
    try {
      const ret = chiiApp.cloud_settings.update({ [key]: val });
      if (ret && typeof ret.then === 'function') {
        return ret;
      }
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }
  try {
    localStorage.setItem(key, val);
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve();
}

export function saveProvider(val) {
  return save(PROVIDER_KEY, val);
}

export function normalizeProvider(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\/\//.test(s)) {
    s = 'https:' + s;
  } else if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(s)) {
    s = 'https://' + s;
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export function saveShow(val) {
  return save(SHOW_KEY, val);
}
