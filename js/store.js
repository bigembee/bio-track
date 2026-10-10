/**
 * AgroSense - persistence
 * ---------------------------------------------------------------
 * Thin wrapper over localStorage / sessionStorage. Every key is
 * namespaced, every read is guarded: storage can be missing, full or
 * blocked (private windows, file:// in some browsers), and none of
 * that may stop the dashboard from rendering.
 */
(function (NS) {
  'use strict';

  var PREFIX = 'agrosense.';

  function make(storage) {
    return {
      get: function (key, fallback) {
        try {
          var raw = storage.getItem(PREFIX + key);
          return raw == null ? fallback : JSON.parse(raw);
        } catch (err) {
          return fallback;
        }
      },
      set: function (key, value) {
        try {
          storage.setItem(PREFIX + key, JSON.stringify(value));
          return true;
        } catch (err) {
          return false;
        }
      },
      remove: function (key) {
        try { storage.removeItem(PREFIX + key); } catch (err) { /* ignore */ }
      }
    };
  }

  function safe(name) {
    try { return window[name]; } catch (err) { return null; }
  }

  var noop = { get: function (k, f) { return f; }, set: function () { return false; }, remove: function () {} };

  NS.store = {
    local: safe('localStorage') ? make(window.localStorage) : noop,
    session: safe('sessionStorage') ? make(window.sessionStorage) : noop
  };
})(window.AgroSense);
