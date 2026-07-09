/* Deadlock Wiki – Konto-System (E-Mail + Passwort)
   Fan-Projekt ohne Server: Alle Konten liegen im localStorage dieses
   Browsers. Passwörter werden nie im Klartext gespeichert, sondern mit
   PBKDF2-SHA-256 gehasht. Da keine E-Mails verschickt werden können,
   ersetzt ein Wiederherstellungs-Code die "Passwort vergessen"-Mail. */
(function () {
  "use strict";

  var USERS_KEY = "dlwiki_users";
  var SESSION_KEY = "dlwiki_session";
  var LEGACY_KEY = "dlwiki_account";
  var ITERATIONS = 60000;

  // ---------- Speicher ----------
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

  function sessionEmail() { return localStorage.getItem(SESSION_KEY); }

  function getAccount() {
    var email = sessionEmail();
    if (!email) return null;
    return getUsers()[email] || null;
  }
  function saveAccount(acc) {
    if (!acc || !acc.email) return;
    var users = getUsers();
    users[acc.email.toLowerCase()] = acc;
    saveUsers(users);
  }
  function isLoggedIn() { return !!getAccount(); }
  function logout() { localStorage.removeItem(SESSION_KEY); }
  function deleteAccount() {
    var email = sessionEmail();
    if (email) {
      var users = getUsers();
      delete users[email];
      saveUsers(users);
    }
    logout();
  }

  // Altes Konto (Version ohne E-Mail) fuer die Registrierung einlesen
  function legacyAccount() {
    try { return JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch (e) { return null; }
  }
  function clearLegacy() {
    localStorage.removeItem(LEGACY_KEY);
  }

  // ---------- Krypto ----------
  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }
  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    return toHex(a.buffer);
  }
  function hashPassword(password, saltHex) {
    if (window.crypto && crypto.subtle && crypto.subtle.importKey) {
      var enc = new TextEncoder();
      var salt = new Uint8Array(saltHex.match(/.{2}/g).map(function (h) { return parseInt(h, 16); }));
      return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
        .then(function (key) {
          return crypto.subtle.deriveBits(
            { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: ITERATIONS }, key, 256);
        })
        .then(toHex);
    }
    // Notnagel fuer sehr alte Browser (nur Demo-Qualitaet)
    var h = 5381, s = saltHex + "|" + password;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return Promise.resolve("djb2-" + h.toString(16));
  }

  function makeRecoveryCode() {
    var chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var groups = [];
    for (var g = 0; g < 3; g++) {
      var part = "";
      for (var i = 0; i < 4; i++) part += chars[Math.floor(Math.random() * chars.length)];
      groups.push(part);
    }
    return groups.join("-");
  }
  function normCode(c) { return (c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  // ---------- Auth-Aktionen ----------
  function register(opts) {
    var email = (opts.email || "").trim().toLowerCase();
    var users = getUsers();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return Promise.resolve({ error: "Bitte gib eine gültige E-Mail-Adresse ein." });
    }
    if (users[email]) {
      return Promise.resolve({ error: "Für diese E-Mail existiert hier bereits ein Konto — melde dich an." });
    }
    if ((opts.name || "").trim().length < 2) {
      return Promise.resolve({ error: "Bitte gib einen Anzeigenamen ein (mindestens 2 Zeichen)." });
    }
    if ((opts.password || "").length < 8) {
      return Promise.resolve({ error: "Das Passwort muss mindestens 8 Zeichen lang sein." });
    }
    var pwSalt = randomHex(16), rcSalt = randomHex(16);
    var code = makeRecoveryCode();
    var legacy = legacyAccount();
    return hashPassword(opts.password, pwSalt).then(function (pwHash) {
      return hashPassword(normCode(code), rcSalt).then(function (rcHash) {
        var acc = {
          name: opts.name.trim(),
          email: email,
          avatar: opts.avatar || "abrams",
          created: Date.now(),
          favorites: (legacy && legacy.favorites) || [],
          steamId: (legacy && legacy.steamId) || null,
          pw: { salt: pwSalt, hash: pwHash, iter: ITERATIONS },
          recovery: { salt: rcSalt, hash: rcHash }
        };
        users[email] = acc;
        saveUsers(users);
        localStorage.setItem(SESSION_KEY, email);
        clearLegacy();
        return { ok: true, recoveryCode: code };
      });
    });
  }

  function login(email, password) {
    email = (email || "").trim().toLowerCase();
    var acc = getUsers()[email];
    if (!acc) return Promise.resolve({ error: "Kein Konto mit dieser E-Mail gefunden. In diesem Browser registriert?" });
    return hashPassword(password || "", acc.pw.salt).then(function (h) {
      if (h !== acc.pw.hash) return { error: "Falsches Passwort. Versuch es erneut oder nutze „Passwort vergessen“." };
      localStorage.setItem(SESSION_KEY, email);
      return { ok: true };
    });
  }

  function resetPassword(email, code, newPassword) {
    email = (email || "").trim().toLowerCase();
    var users = getUsers();
    var acc = users[email];
    if (!acc) return Promise.resolve({ error: "Kein Konto mit dieser E-Mail gefunden." });
    if ((newPassword || "").length < 8) {
      return Promise.resolve({ error: "Das neue Passwort muss mindestens 8 Zeichen lang sein." });
    }
    return hashPassword(normCode(code), acc.recovery.salt).then(function (h) {
      if (h !== acc.recovery.hash) return { error: "Der Wiederherstellungs-Code ist falsch." };
      var salt = randomHex(16);
      return hashPassword(newPassword, salt).then(function (pwHash) {
        acc.pw = { salt: salt, hash: pwHash, iter: ITERATIONS };
        users[email] = acc;
        saveUsers(users);
        localStorage.setItem(SESSION_KEY, email);
        return { ok: true };
      });
    });
  }

  function changePassword(oldPassword, newPassword) {
    var acc = getAccount();
    if (!acc) return Promise.resolve({ error: "Nicht angemeldet." });
    if ((newPassword || "").length < 8) {
      return Promise.resolve({ error: "Das neue Passwort muss mindestens 8 Zeichen lang sein." });
    }
    return hashPassword(oldPassword || "", acc.pw.salt).then(function (h) {
      if (h !== acc.pw.hash) return { error: "Das aktuelle Passwort ist falsch." };
      var salt = randomHex(16);
      return hashPassword(newPassword, salt).then(function (pwHash) {
        acc.pw = { salt: salt, hash: pwHash, iter: ITERATIONS };
        saveAccount(acc);
        return { ok: true };
      });
    });
  }

  window.DLWiki = {
    getAccount: getAccount,
    saveAccount: saveAccount,
    isLoggedIn: isLoggedIn,
    logout: logout,
    deleteAccount: deleteAccount,
    register: register,
    login: login,
    resetPassword: resetPassword,
    changePassword: changePassword,
    legacyAccount: legacyAccount,
    knownEmails: function () { return Object.keys(getUsers()); }
  };

  // ---------- UI auf allen Seiten ----------
  function refreshNav() {
    var navLink = document.querySelector("[data-nav-account]");
    if (!navLink) return;
    var acc = getAccount();
    if (acc) {
      navLink.innerHTML = "";
      var img = document.createElement("img");
      img.src = "assets/heroes/sm/" + (acc.avatar || "abrams") + ".webp";
      img.alt = "";
      navLink.appendChild(img);
      navLink.appendChild(document.createTextNode(acc.name));
      navLink.title = "Zum Profil";
    } else {
      navLink.textContent = "Anmelden";
    }
  }
  window.DLWiki.refreshNav = refreshNav;

  document.addEventListener("DOMContentLoaded", function () {
    refreshNav();

    var favBtn = document.querySelector("[data-fav-hero]");
    if (favBtn) {
      var slug = favBtn.getAttribute("data-fav-hero");
      var renderFav = function () {
        var acc = getAccount();
        var faved = acc && (acc.favorites || []).indexOf(slug) !== -1;
        favBtn.textContent = faved ? "★ Favorit" : "☆ Favorit";
        favBtn.setAttribute("data-faved", faved ? "true" : "false");
        favBtn.classList.add("fav-btn");
      };
      renderFav();
      favBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var acc = getAccount();
        if (!acc) { window.location.href = "profil.html"; return; }
        acc.favorites = acc.favorites || [];
        var i = acc.favorites.indexOf(slug);
        if (i === -1) acc.favorites.push(slug); else acc.favorites.splice(i, 1);
        saveAccount(acc);
        renderFav();
      });
    }
  });
})();
