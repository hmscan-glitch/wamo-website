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
  var ITERATIONS = 600000;
  var LEGACY_ITERATIONS = 60000;
  var CRYPTO_ERROR = "Sicheres Speichern wird von diesem Browser nicht unterstützt. Bitte verwende einen aktuellen Browser über HTTPS.";

  // ---------- Speicher ----------
  function getUsers() {
    try {
      var parsed = JSON.parse(localStorage.getItem(USERS_KEY));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) { return {}; }
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
  function hasWebCrypto() {
    return !!(window.crypto && crypto.getRandomValues && crypto.subtle && crypto.subtle.importKey && window.TextEncoder);
  }
  function randomHex(bytes) {
    if (!hasWebCrypto()) throw new Error("WEB_CRYPTO_UNAVAILABLE");
    var a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return toHex(a.buffer);
  }
  function legacyHash(password, saltHex) {
    var h = 5381, s = saltHex + "|" + password;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return "djb2-" + h.toString(16);
  }
  function hashPassword(password, saltHex, iterations) {
    if (!hasWebCrypto()) return Promise.reject(new Error("WEB_CRYPTO_UNAVAILABLE"));
    if (!/^[0-9a-f]+$/i.test(saltHex || "") || saltHex.length % 2) {
      return Promise.reject(new Error("INVALID_SALT"));
    }
    var enc = new TextEncoder();
    var salt = new Uint8Array(saltHex.match(/.{2}/g).map(function (h) { return parseInt(h, 16); }));
    return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iterations || ITERATIONS }, key, 256);
      })
      .then(toHex);
  }
  function verifySecret(value, record) {
    if (!record || !record.salt || !record.hash) return Promise.resolve(false);
    if (record.hash.indexOf("djb2-") === 0) {
      return Promise.resolve(legacyHash(value, record.salt) === record.hash);
    }
    if (record.alg && record.alg !== "PBKDF2-SHA256") return Promise.resolve(false);
    return hashPassword(value, record.salt, record.iter || LEGACY_ITERATIONS)
      .then(function (hash) { return hash === record.hash; });
  }
  function randomIndex(limit) {
    var bytes = new Uint8Array(1);
    var ceiling = Math.floor(256 / limit) * limit;
    do { crypto.getRandomValues(bytes); } while (bytes[0] >= ceiling);
    return bytes[0] % limit;
  }

  function makeRecoveryCode() {
    if (!hasWebCrypto()) throw new Error("WEB_CRYPTO_UNAVAILABLE");
    var chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var groups = [];
    for (var g = 0; g < 3; g++) {
      var part = "";
      for (var i = 0; i < 4; i++) part += chars[randomIndex(chars.length)];
      groups.push(part);
    }
    return groups.join("-");
  }
  function normCode(c) { return (c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  // ---------- Auth-Aktionen ----------
  function register(opts) {
    var email = (opts.email || "").trim().toLowerCase();
    var users = getUsers();
    if (!hasWebCrypto()) return Promise.resolve({ error: CRYPTO_ERROR });
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
    var legacyFavorites = legacy && Array.isArray(legacy.favorites) ? legacy.favorites : [];
    legacyFavorites = legacyFavorites.filter(function (slug, index, all) {
      return typeof slug === "string" && /^[a-z0-9-]+$/.test(slug) && all.indexOf(slug) === index;
    }).slice(0, 100);
    var legacySteamId = legacy && /^\d{1,10}$/.test(String(legacy.steamId || "")) ? String(legacy.steamId) : null;
    return Promise.all([
      hashPassword(opts.password, pwSalt, ITERATIONS),
      hashPassword(normCode(code), rcSalt, ITERATIONS)
    ]).then(function (hashes) {
        var pwHash = hashes[0], rcHash = hashes[1];
        var acc = {
          name: opts.name.trim(),
          email: email,
          avatar: opts.avatar || "abrams",
          created: Date.now(),
          favorites: legacyFavorites,
          steamId: legacySteamId,
          pw: { alg: "PBKDF2-SHA256", salt: pwSalt, hash: pwHash, iter: ITERATIONS },
          recovery: { alg: "PBKDF2-SHA256", salt: rcSalt, hash: rcHash, iter: ITERATIONS }
        };
        var latestUsers = getUsers();
        if (latestUsers[email]) {
          return { error: "Für diese E-Mail existiert hier bereits ein Konto — melde dich an." };
        }
        latestUsers[email] = acc;
        saveUsers(latestUsers);
        localStorage.setItem(SESSION_KEY, email);
        clearLegacy();
        return { ok: true, recoveryCode: code };
      })
      .catch(function () { return { error: CRYPTO_ERROR }; });
  }

  function login(email, password) {
    email = (email || "").trim().toLowerCase();
    var acc = getUsers()[email];
    if (!hasWebCrypto()) return Promise.resolve({ error: CRYPTO_ERROR });
    if (!acc) return Promise.resolve({ error: "Kein Konto mit dieser E-Mail gefunden. In diesem Browser registriert?" });
    return verifySecret(password || "", acc.pw).then(function (matches) {
      if (!matches) return { error: "Falsches Passwort. Versuch es erneut oder nutze „Passwort vergessen“." };

      function finishLogin() {
        localStorage.setItem(SESSION_KEY, email);
        return { ok: true };
      }

      var currentIterations = Number(acc.pw && acc.pw.iter) || LEGACY_ITERATIONS;
      var needsUpgrade = acc.pw.hash.indexOf("djb2-") === 0 || currentIterations < ITERATIONS;
      if (!needsUpgrade) return finishLogin();

      var salt = randomHex(16);
      return hashPassword(password || "", salt, ITERATIONS).then(function (hash) {
        acc.pw = { alg: "PBKDF2-SHA256", salt: salt, hash: hash, iter: ITERATIONS };
        saveAccount(acc);
        return finishLogin();
      });
    }).catch(function () { return { error: CRYPTO_ERROR }; });
  }

  function resetPassword(email, code, newPassword) {
    email = (email || "").trim().toLowerCase();
    var users = getUsers();
    var acc = users[email];
    if (!hasWebCrypto()) return Promise.resolve({ error: CRYPTO_ERROR });
    if (!acc) return Promise.resolve({ error: "Kein Konto mit dieser E-Mail gefunden." });
    if ((newPassword || "").length < 8) {
      return Promise.resolve({ error: "Das neue Passwort muss mindestens 8 Zeichen lang sein." });
    }
    return verifySecret(normCode(code), acc.recovery).then(function (matches) {
      if (!matches) return { error: "Der Wiederherstellungs-Code ist falsch." };
      var pwSalt = randomHex(16), rcSalt = randomHex(16);
      var nextCode = makeRecoveryCode();
      return Promise.all([
        hashPassword(newPassword, pwSalt, ITERATIONS),
        hashPassword(normCode(nextCode), rcSalt, ITERATIONS)
      ]).then(function (hashes) {
        acc.pw = { alg: "PBKDF2-SHA256", salt: pwSalt, hash: hashes[0], iter: ITERATIONS };
        acc.recovery = { alg: "PBKDF2-SHA256", salt: rcSalt, hash: hashes[1], iter: ITERATIONS };
        users[email] = acc;
        saveUsers(users);
        localStorage.setItem(SESSION_KEY, email);
        return { ok: true, recoveryCode: nextCode };
      });
    }).catch(function () { return { error: CRYPTO_ERROR }; });
  }

  function changePassword(oldPassword, newPassword) {
    var acc = getAccount();
    if (!hasWebCrypto()) return Promise.resolve({ error: CRYPTO_ERROR });
    if (!acc) return Promise.resolve({ error: "Nicht angemeldet." });
    if ((newPassword || "").length < 8) {
      return Promise.resolve({ error: "Das neue Passwort muss mindestens 8 Zeichen lang sein." });
    }
    return verifySecret(oldPassword || "", acc.pw).then(function (matches) {
      if (!matches) return { error: "Das aktuelle Passwort ist falsch." };
      var salt = randomHex(16);
      return hashPassword(newPassword, salt, ITERATIONS).then(function (pwHash) {
        acc.pw = { alg: "PBKDF2-SHA256", salt: salt, hash: pwHash, iter: ITERATIONS };
        saveAccount(acc);
        return { ok: true };
      });
    }).catch(function () { return { error: CRYPTO_ERROR }; });
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

  // ---------- Gemeinsame UI auf allen Seiten ----------
  function enhanceSharedChrome() {
    var main = document.querySelector("main");
    if (main) {
      if (!main.id) main.id = "main-content";
      if (!document.querySelector(".skip-link")) {
        var skip = document.createElement("a");
        skip.className = "skip-link";
        skip.href = "#" + main.id;
        skip.textContent = "Zum Inhalt springen";
        document.body.insertBefore(skip, document.body.firstChild);
      }
    }

    var masthead = document.querySelector(".masthead");
    var localnav = masthead && masthead.querySelector(":scope > .localnav");
    if (masthead && localnav) masthead.insertAdjacentElement("afterend", localnav);

    var stats = document.querySelector(".nav-stats");
    if (stats) stats.textContent = "38 Helden · Fanprojekt";

    Array.prototype.forEach.call(document.querySelectorAll(".localnav a.redlink"), function (link) {
      if (link.textContent.trim() !== "Community") return;
      link.href = "https://github.com/hmscan-glitch/wamo-website/issues";
      link.classList.remove("redlink");
      link.title = "Auf GitHub mithelfen oder einen Fehler melden";
    });

    Array.prototype.forEach.call(document.querySelectorAll('.wikifoot a[href="#"]'), function (link) {
      if (link.textContent.trim() !== "Impressum") return;
      var note = document.createElement("span");
      note.className = "footer-note";
      note.textContent = "Impressum noch nicht hinterlegt";
      link.replaceWith(note);
    });
  }

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
    enhanceSharedChrome();
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
