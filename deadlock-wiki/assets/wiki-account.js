/* Deadlock Wiki – echtes Konto-System mit Supabase Auth.
   Der Publishable Key ist absichtlich öffentlich. Sicherheit wird durch
   Supabase Auth und Row Level Security (RLS) in der Datenbank erzwungen. */
(function () {
  "use strict";

  var SUPABASE_URL = "https://pyuafykqrmcfwwzvsgxh.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ByvOk_7SWDY_r_OJO1oAVA_-3MvFmMq";
  var SUPABASE_SCRIPT = "assets/vendor/supabase-2.112.3.min.js";
  var SUPABASE_SRI = "sha384-l8ah+VgaWtk1mvOe9VC+OirC6qHFF4yH7l7mKRidV9MSti3E9F463bMp6ZVN4kuC";
  var AUTH_STORAGE_KEY = "dlwiki-supabase-auth";
  var AUTH_LOCK_NAME = "dlwiki-auth-operation";
  var REGISTRATION_ENABLED = false;
  var LEGACY_USERS_KEY = "dlwiki_users";
  var LEGACY_ACCOUNT_KEY = "dlwiki_account";
  var DEFAULT_AVATAR = "abrams";
  var account = null;
  var client = null;
  var listeners = [];
  var recoverySession = null;
  var sessionGeneration = 0;
  var activeSessionKey = null;
  var hydratingSessionKey = null;
  var hydrationPromise = null;

  // Bestehende lokale Konten werden nicht mehr zur Anmeldung verwendet, aber
  // auch nicht gelöscht. Eine spätere, ausdrücklich bestätigte Migration kann
  // deren nicht geheime Profildaten übernehmen, ohne Passwort-Hashes zu senden.
  function hasLegacyAccount() {
    try { return !!(localStorage.getItem(LEGACY_USERS_KEY) || localStorage.getItem(LEGACY_ACCOUNT_KEY)); }
    catch (e) { return false; }
  }

  function loadSupabase() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-dlwiki-supabase]');
      if (existing) {
        existing.addEventListener("load", function () { resolve(window.supabase); }, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      var script = document.createElement("script");
      script.src = SUPABASE_SCRIPT;
      script.integrity = SUPABASE_SRI;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.dlwikiSupabase = "true";
      script.addEventListener("load", function () {
        if (window.supabase && window.supabase.createClient) resolve(window.supabase);
        else reject(new Error("SUPABASE_SDK_UNAVAILABLE"));
      }, { once: true });
      script.addEventListener("error", function () { reject(new Error("SUPABASE_SDK_UNAVAILABLE")); }, { once: true });
      document.head.appendChild(script);
    });
  }

  function publicProfileUrl(mode) {
    var url = new URL("profil.html", window.location.href);
    url.search = mode ? "?" + mode : "";
    url.hash = "";
    return url.href;
  }

  function validAvatar(value) {
    return typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value) ? value : DEFAULT_AVATAR;
  }

  function validFavorites(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (slug, index, all) {
      return typeof slug === "string" && /^[a-z0-9-]{1,60}$/.test(slug) && all.indexOf(slug) === index;
    }).slice(0, 100);
  }

  function normalizeAccount(user, profile) {
    if (!user) return null;
    profile = profile || {};
    var metadata = user.user_metadata || {};
    var fallbackName = (user.email || "Wiki-Nutzer").split("@")[0];
    var created = profile.created_at || user.created_at || new Date().toISOString();
    var updated = profile.updated_at || created;
    return {
      id: user.id,
      email: user.email || "",
      emailConfirmed: !!user.email_confirmed_at,
      name: String(profile.display_name || metadata.display_name || fallbackName).slice(0, 24),
      avatar: validAvatar(profile.avatar || metadata.avatar),
      steamId: profile.steam_id ? String(profile.steam_id) : null,
      favorites: validFavorites(profile.favorites),
      created: new Date(created).getTime(),
      updatedAt: String(updated)
    };
  }

  function errorMessage(error, fallback) {
    var message = String(error && error.message || "").toLowerCase();
    if (message.indexOf("invalid login credentials") !== -1) return "E-Mail-Adresse oder Passwort ist falsch.";
    if (message.indexOf("email not confirmed") !== -1) return "Bitte bestätige zuerst deine E-Mail-Adresse. Prüfe auch den Spam-Ordner.";
    if (message.indexOf("user already registered") !== -1) return "Für diese E-Mail-Adresse gibt es bereits ein Konto.";
    if (message.indexOf("password") !== -1 && (message.indexOf("short") !== -1 || message.indexOf("least") !== -1)) {
      return "Das Passwort muss mindestens 10 Zeichen lang sein.";
    }
    if (message.indexOf("rate limit") !== -1 || message.indexOf("too many") !== -1) {
      return "Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.";
    }
    if (message.indexOf("failed to fetch") !== -1 || message.indexOf("network") !== -1 || message.indexOf("sdk_unavailable") !== -1) {
      return "Die Anmeldung ist gerade nicht erreichbar. Prüfe deine Internetverbindung und versuche es erneut.";
    }
    return fallback || "Das hat leider nicht funktioniert. Bitte versuche es erneut.";
  }

  function reauthErrorMessage(error) {
    var message = String(error && error.message || "").toLowerCase();
    if (message.indexOf("invalid login credentials") !== -1) return "Das aktuelle Passwort ist falsch.";
    return errorMessage(error, "Die Sicherheitsprüfung ist gerade nicht möglich. Bitte versuche es erneut.");
  }

  function withAuthLock(action) {
    if (window.navigator && window.navigator.locks && window.navigator.locks.request) {
      return window.navigator.locks.request(AUTH_LOCK_NAME, function () {
        return Promise.resolve().then(action);
      });
    }
    return Promise.resolve().then(action);
  }

  function sessionUserId(result) {
    var session = result && result.data && result.data.session;
    return session && session.user ? session.user.id : null;
  }

  function emitAccountChange(event) {
    refreshNav();
    listeners.slice().forEach(function (listener) {
      try { listener(getAccount(), event || "ACCOUNT_UPDATED"); } catch (e) { /* UI-Fehler isolieren */ }
    });
  }

  function readProfile(user) {
    return client.from("profiles")
      .select("display_name,avatar,steam_id,favorites,created_at,updated_at")
      .eq("id", user.id)
      .maybeSingle()
      .then(function (result) {
        if (result.error) throw result.error;
        return result.data;
      });
  }

  function createMissingProfile(user) {
    var metadata = user.user_metadata || {};
    var fallbackName = (user.email || "Wiki-Nutzer").split("@")[0];
    var row = {
      id: user.id,
      display_name: String(metadata.display_name || fallbackName).slice(0, 24),
      avatar: validAvatar(metadata.avatar),
      steam_id: null,
      favorites: []
    };
    return client.from("profiles").insert(row).select("display_name,avatar,steam_id,favorites,created_at,updated_at").single()
      .then(function (result) {
        if (result.error) throw result.error;
        return result.data;
      });
  }

  function sessionIdentifier(session) {
    var token = String(session && session.access_token || "");
    var encodedPayload = token.split(".")[1];
    if (encodedPayload) {
      try {
        var normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
        while (normalized.length % 4) normalized += "=";
        var claims = JSON.parse(window.atob(normalized));
        if (claims && claims.session_id) return String(claims.session_id);
      } catch (e) { /* Fallback auf das Refresh-Token */ }
    }
    return String(session && session.refresh_token || "");
  }

  function authSessionKey(session) {
    return session && session.user ? session.user.id + ":" + sessionIdentifier(session) : "signed-out";
  }

  function hydrateSession(session, event) {
    var key = authSessionKey(session);
    if (hydrationPromise && key === hydratingSessionKey) {
      return hydrationPromise.then(function (value) {
        if (event === "PASSWORD_RECOVERY") emitAccountChange(event);
        return value;
      });
    }
    if (activeSessionKey !== null && activeSessionKey !== key) sessionGeneration += 1;
    var generation = sessionGeneration;
    activeSessionKey = key;
    hydratingSessionKey = key;
    var work;
    if (!session || !session.user) {
      account = null;
      work = Promise.resolve(null).then(function (value) {
        emitAccountChange(event || "SIGNED_OUT");
        return value;
      });
    } else {
      work = readProfile(session.user)
        .then(function (profile) {
          if (profile) return profile;
          return createMissingProfile(session.user);
        })
        .catch(function () {
          // Auth bleibt nutzbar, selbst wenn das Profil-Schema vorübergehend nicht erreichbar ist.
          return null;
        })
        .then(function (profile) {
          if (generation !== sessionGeneration || activeSessionKey !== key) return account;
          account = normalizeAccount(session.user, profile);
          emitAccountChange(event || "SIGNED_IN");
          return account;
        });
    }
    var pending = work.finally(function () {
      if (hydrationPromise === pending) {
        hydrationPromise = null;
        hydratingSessionKey = null;
      }
    });
    hydrationPromise = pending;
    return hydrationPromise;
  }

  var ready = loadSupabase()
    .then(function (sdk) {
      client = sdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: AUTH_STORAGE_KEY
        }
      });
      client.auth.onAuthStateChange(function (event, session) {
        if (event === "PASSWORD_RECOVERY" && session && session.user) {
          recoverySession = { key: authSessionKey(session), userId: session.user.id };
        } else if (recoverySession && (!session || recoverySession.key !== authSessionKey(session))) {
          recoverySession = null;
        }
        // Supabase empfiehlt, weitere Client-Aufrufe außerhalb des Callbacks zu starten.
        window.setTimeout(function () { hydrateSession(session, event); }, 0);
      });
      return client.auth.getSession();
    })
    .then(function (result) {
      if (result.error) throw result.error;
      return hydrateSession(result.data.session, "INITIAL_SESSION");
    })
    .catch(function (error) {
      account = null;
      emitAccountChange("INIT_ERROR");
      throw error;
    });

  function getAccount() {
    return account ? Object.assign({}, account, { favorites: account.favorites.slice() }) : null;
  }
  function isLoggedIn() { return !!account; }
  function isPasswordRecovery() { return !!recoverySession; }

  function register(opts) {
    if (!REGISTRATION_ENABLED) {
      return Promise.resolve({ error: "Die Registrierung ist während der technischen Testphase noch geschlossen." });
    }
    opts = opts || {};
    var email = String(opts.email || "").trim().toLowerCase();
    var name = String(opts.name || "").trim();
    var password = String(opts.password || "");
    var avatar = validAvatar(opts.avatar);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return Promise.resolve({ error: "Bitte gib eine gültige E-Mail-Adresse ein." });
    }
    if (name.length < 2 || name.length > 24) {
      return Promise.resolve({ error: "Der Anzeigename muss zwischen 2 und 24 Zeichen lang sein." });
    }
    if (password.length < 10) return Promise.resolve({ error: "Das Passwort muss mindestens 10 Zeichen lang sein." });
    return ready.then(function () {
      return withAuthLock(function () {
        return client.auth.signUp({
          email: email,
          password: password,
          options: {
            emailRedirectTo: publicProfileUrl("auth=confirmed"),
            data: { display_name: name, avatar: avatar }
          }
        }).then(function (result) {
          if (result.error) return { error: errorMessage(result.error, "Das Konto konnte nicht erstellt werden.") };
          if (result.data.session) {
            return hydrateSession(result.data.session, "SIGNED_IN").then(function () { return { ok: true, needsConfirmation: false }; });
          }
          return { ok: true, needsConfirmation: true };
        });
      });
    }).catch(function (error) {
      return { error: errorMessage(error, "Das Konto konnte nicht erstellt werden.") };
    });
  }

  function login(email, password) {
    email = String(email || "").trim().toLowerCase();
    return ready.then(function () {
      return withAuthLock(function () {
        return client.auth.signInWithPassword({ email: email, password: String(password || "") })
          .then(function (result) {
            if (result.error) return { error: errorMessage(result.error) };
            return hydrateSession(result.data.session, "SIGNED_IN").then(function () { return { ok: true }; });
          });
      });
    }).catch(function (error) { return { error: errorMessage(error) }; });
  }

  function logout() {
    if (!account) return Promise.resolve({ ok: true });
    var accountId = account.id;
    return ready.then(function () {
      return withAuthLock(function () {
        return client.auth.getSession().then(function (sessionResult) {
          if (sessionResult.error) return { error: errorMessage(sessionResult.error, "Die Sitzung konnte nicht geprüft werden.") };
          if (sessionUserId(sessionResult) !== accountId) {
            return hydrateSession(sessionResult.data.session, sessionUserId(sessionResult) ? "SIGNED_IN" : "SIGNED_OUT").then(function () {
              return { error: "Deine Anmeldung hat sich geändert. Bitte prüfe das aktuell angemeldete Konto." };
            });
          }
          return client.auth.signOut({ scope: "local" }).then(function (result) {
            if (result.error) {
              if (clearLocalAuthStorageFor(accountId)) {
                recoverySession = null;
                account = null;
                emitAccountChange("SIGNED_OUT");
                return { ok: true, localOnly: true };
              }
              return { error: errorMessage(result.error, "Das Abmelden ist fehlgeschlagen. Bitte versuche es erneut.") };
            }
            recoverySession = null;
            account = null;
            emitAccountChange("SIGNED_OUT");
            return { ok: true };
          });
        });
      });
    }).catch(function (error) {
      return { error: errorMessage(error, "Das Abmelden ist fehlgeschlagen. Bitte versuche es erneut.") };
    });
  }

  function clearLocalAuthStorageFor(userId) {
    try {
      var stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
      if (!stored || !stored.user || stored.user.id !== userId) return false;
      Object.keys(localStorage).forEach(function (key) {
        if (key === AUTH_STORAGE_KEY || key.indexOf(AUTH_STORAGE_KEY + "-") === 0) localStorage.removeItem(key);
      });
      return true;
    } catch (e) { /* privater Browsermodus */ }
    return false;
  }

  function createIsolatedAuthClient() {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }

  function requestPasswordReset(email) {
    email = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return Promise.resolve({ error: "Bitte gib eine gültige E-Mail-Adresse ein." });
    }
    return ready.then(function () {
      return client.auth.resetPasswordForEmail(email, { redirectTo: publicProfileUrl("mode=reset") });
    }).then(function (result) {
      if (result.error) return { error: errorMessage(result.error, "Die E-Mail konnte nicht versendet werden.") };
      return { ok: true };
    }).catch(function (error) { return { error: errorMessage(error, "Die E-Mail konnte nicht versendet werden.") }; });
  }

  function completePasswordReset(newPassword) {
    if (!recoverySession) {
      return Promise.resolve({ error: "Der Passwort-Link ist ungültig oder abgelaufen. Fordere bitte einen neuen Link an." });
    }
    if (String(newPassword || "").length < 10) {
      return Promise.resolve({ error: "Das neue Passwort muss mindestens 10 Zeichen lang sein." });
    }
    return ready.then(function () {
      return withAuthLock(function () {
        if (!recoverySession) {
          return { error: "Der Passwort-Link ist ungültig oder abgelaufen. Fordere bitte einen neuen Link an." };
        }
        var expectedRecovery = { key: recoverySession.key, userId: recoverySession.userId };
        return client.auth.getSession().then(function (sessionResult) {
          if (sessionResult.error || authSessionKey(sessionResult.data.session) !== expectedRecovery.key ||
              sessionUserId(sessionResult) !== expectedRecovery.userId) {
            recoverySession = null;
            return { error: "Die Wiederherstellungssitzung ist abgelaufen oder wurde durch eine andere Anmeldung ersetzt." };
          }
          return client.auth.updateUser({ password: String(newPassword) }).then(function (result) {
            if (result.error) return { error: errorMessage(result.error, "Das Passwort konnte nicht geändert werden.") };
            recoverySession = null;
            return { ok: true };
          });
        });
      });
    }).catch(function (error) { return { error: errorMessage(error, "Das Passwort konnte nicht geändert werden.") }; });
  }

  function changePassword(oldPassword, newPassword) {
    if (!account) return Promise.resolve({ error: "Du bist nicht angemeldet." });
    if (String(newPassword || "").length < 10) {
      return Promise.resolve({ error: "Das neue Passwort muss mindestens 10 Zeichen lang sein." });
    }
    var accountId = account.id;
    var email = account.email;
    var verificationClient;
    return ready.then(function () {
      return withAuthLock(function () {
        return client.auth.getSession().then(function (sessionResult) {
          if (sessionResult.error) return { error: errorMessage(sessionResult.error, "Die Sitzung konnte nicht geprüft werden.") };
          if (sessionUserId(sessionResult) !== accountId) {
            return hydrateSession(sessionResult.data.session, sessionUserId(sessionResult) ? "SIGNED_IN" : "SIGNED_OUT")
              .then(function () { return { error: "Deine Anmeldung hat sich geändert. Bitte prüfe das aktuell angemeldete Konto." }; });
          }
          verificationClient = createIsolatedAuthClient();
          return verificationClient.auth.signInWithPassword({ email: email, password: String(oldPassword || "") })
            .then(function (verifyResult) {
              if (verifyResult.error) return { error: reauthErrorMessage(verifyResult.error) };
              if (!verifyResult.data.user || verifyResult.data.user.id !== accountId) {
                return { error: "Die Sicherheitsprüfung gehört nicht zum aktuell angemeldeten Konto." };
              }
              return client.auth.getSession().then(function (currentResult) {
                if (currentResult.error || sessionUserId(currentResult) !== accountId) {
                  return { error: "Deine Anmeldung hat sich während der Sicherheitsprüfung geändert. Bitte versuche es erneut." };
                }
                return verificationClient.auth.updateUser({ password: String(newPassword) }).then(function (updateResult) {
                  if (updateResult.error) return { error: errorMessage(updateResult.error, "Das Passwort konnte nicht geändert werden.") };
                  return { ok: true };
                });
              });
            }).finally(function () {
              if (verificationClient) return verificationClient.auth.signOut({ scope: "local" }).catch(function () { return null; });
            });
        });
      });
    }).catch(function (error) { return { error: errorMessage(error, "Das Passwort konnte nicht geändert werden.") }; });
  }

  function saveAccount(next) {
    if (!account || !next) return Promise.resolve({ error: "Du bist nicht angemeldet." });
    var accountId = account.id;
    var saveGeneration = sessionGeneration;
    var accountSnapshot = {
      id: account.id,
      email: account.email,
      emailConfirmed: account.emailConfirmed,
      created: account.created
    };
    var expectedUpdatedAt = account.updatedAt;
    var row = {
      display_name: String(next.name || account.name).trim().slice(0, 24),
      avatar: validAvatar(next.avatar || account.avatar),
      steam_id: next.steamId ? String(next.steamId) : null,
      favorites: validFavorites(next.favorites)
    };
    if (row.display_name.length < 2) return Promise.resolve({ error: "Der Anzeigename ist zu kurz." });
    return ready.then(function () {
      if (saveGeneration !== sessionGeneration || !account || account.id !== accountId) {
        throw new Error("SESSION_CHANGED_DURING_SAVE");
      }
      return client.from("profiles")
        .update(row)
        .eq("id", accountId)
        .eq("updated_at", expectedUpdatedAt)
        .select("display_name,avatar,steam_id,favorites,created_at,updated_at")
        .maybeSingle();
    }).then(function (result) {
      if (saveGeneration !== sessionGeneration || !account || account.id !== accountId) {
        return { error: "Deine Anmeldung hat sich während des Speicherns geändert. Bitte versuche es erneut." };
      }
      if (result.error) return { error: errorMessage(result.error, "Das Profil konnte nicht gespeichert werden.") };
      if (!result.data) {
        return readProfile({ id: accountId }).then(function (profile) {
          if (saveGeneration !== sessionGeneration || !account || account.id !== accountId) {
            return { error: "Deine Anmeldung hat sich während des Speicherns geändert. Bitte versuche es erneut." };
          }
          if (profile) {
            account = normalizeAccount({
              id: accountSnapshot.id,
              email: accountSnapshot.email,
              email_confirmed_at: accountSnapshot.emailConfirmed ? new Date().toISOString() : null,
              created_at: new Date(accountSnapshot.created).toISOString(),
              user_metadata: {}
            }, profile);
            emitAccountChange("ACCOUNT_UPDATED");
          }
          return { error: "Dein Profil wurde inzwischen in einem anderen Tab geändert. Die aktuelle Version wurde neu geladen." };
        });
      }
      account = normalizeAccount({
        id: accountId,
        email: accountSnapshot.email,
        email_confirmed_at: accountSnapshot.emailConfirmed ? new Date().toISOString() : null,
        created_at: new Date(accountSnapshot.created).toISOString(),
        user_metadata: {}
      }, result.data);
      emitAccountChange("ACCOUNT_UPDATED");
      return { ok: true, account: getAccount() };
    }).catch(function (error) {
      if (error && error.message === "SESSION_CHANGED_DURING_SAVE") {
        return { error: "Deine Anmeldung hat sich während des Speicherns geändert. Bitte versuche es erneut." };
      }
      return { error: errorMessage(error, "Das Profil konnte nicht gespeichert werden.") };
    });
  }

  function deleteAccount(password) {
    if (!account) return Promise.resolve({ error: "Du bist nicht angemeldet." });
    if (!password) return Promise.resolve({ error: "Bitte gib zur Bestätigung dein aktuelles Passwort ein." });
    var accountId = account.id;
    var email = account.email;
    var verificationClient;
    return ready.then(function () {
      return withAuthLock(function () {
        return client.auth.getSession().then(function (sessionResult) {
          if (sessionResult.error) return { error: errorMessage(sessionResult.error, "Die Sitzung konnte nicht geprüft werden.") };
          if (sessionUserId(sessionResult) !== accountId) {
            return hydrateSession(sessionResult.data.session, sessionUserId(sessionResult) ? "SIGNED_IN" : "SIGNED_OUT")
              .then(function () { return { error: "Deine Anmeldung hat sich geändert. Bitte prüfe das aktuell angemeldete Konto." }; });
          }
          verificationClient = createIsolatedAuthClient();
          return verificationClient.auth.signInWithPassword({ email: email, password: String(password) })
            .then(function (verifyResult) {
              if (verifyResult.error) return { error: reauthErrorMessage(verifyResult.error) };
              if (!verifyResult.data.user || verifyResult.data.user.id !== accountId) {
                return { error: "Die Sicherheitsprüfung gehört nicht zum aktuell angemeldeten Konto." };
              }
              return client.auth.getSession().then(function (currentResult) {
                if (currentResult.error || sessionUserId(currentResult) !== accountId) {
                  return { error: "Deine Anmeldung hat sich während der Sicherheitsprüfung geändert. Bitte versuche es erneut." };
                }
                return verificationClient.rpc("delete_own_account");
              });
            }).then(function (result) {
              if (result.error) {
                if (typeof result.error === "string") return result;
                return { error: errorMessage(result.error, "Das Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.") };
              }
              return client.auth.getSession().then(function (currentResult) {
                var currentSession = currentResult.data && currentResult.data.session;
                var currentUserId = sessionUserId(currentResult);
                if (currentUserId && currentUserId !== accountId) {
                  return hydrateSession(currentSession, "SIGNED_IN").then(function () { return { ok: true }; });
                }
                return client.auth.signOut({ scope: "local" }).catch(function () { return null; }).then(function () {
                  clearLocalAuthStorageFor(accountId);
                  recoverySession = null;
                  if (!account || account.id === accountId) {
                    account = null;
                    emitAccountChange("SIGNED_OUT");
                  }
                  return { ok: true };
                });
              });
            }).finally(function () {
              if (verificationClient) {
                return verificationClient.auth.signOut({ scope: "local" }).catch(function () { return null; });
              }
            });
        });
      });
    }).catch(function (error) { return { error: errorMessage(error, "Das Konto konnte nicht gelöscht werden.") }; });
  }

  function onAccountChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    return function () {
      var index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

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

    Array.prototype.forEach.call(document.querySelectorAll(".localnav a"), function (link) {
      if (link.textContent.trim() !== "Community") return;
      link.href = "community.html";
      link.classList.remove("redlink");
      link.removeAttribute("title");
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
    if (account) {
      navLink.replaceChildren();
      var img = document.createElement("img");
      img.src = "assets/heroes/sm/" + account.avatar + ".webp";
      img.alt = "";
      navLink.appendChild(img);
      navLink.appendChild(document.createTextNode(account.name));
      navLink.title = "Zum Profil";
    } else {
      navLink.textContent = "Anmelden";
      navLink.removeAttribute("title");
    }
  }

  window.DLWiki = {
    ready: ready,
    getAccount: getAccount,
    saveAccount: saveAccount,
    isLoggedIn: isLoggedIn,
    isPasswordRecovery: isPasswordRecovery,
    hasLegacyAccount: hasLegacyAccount,
    logout: logout,
    deleteAccount: deleteAccount,
    register: register,
    login: login,
    requestPasswordReset: requestPasswordReset,
    completePasswordReset: completePasswordReset,
    changePassword: changePassword,
    onAccountChange: onAccountChange,
    refreshNav: refreshNav
  };

  function onReady() {
    enhanceSharedChrome();
    refreshNav();
    ready.catch(function () { refreshNav(); });

    var favBtn = document.querySelector("[data-fav-hero]");
    if (!favBtn) return;
    var slug = favBtn.getAttribute("data-fav-hero");
    function renderFav() {
      var current = getAccount();
      var faved = current && current.favorites.indexOf(slug) !== -1;
      favBtn.textContent = faved ? "★ Favorit" : "☆ Favorit";
      favBtn.setAttribute("data-faved", faved ? "true" : "false");
      favBtn.classList.add("fav-btn");
    }
    ready.then(renderFav).catch(renderFav);
    onAccountChange(renderFav);
    favBtn.addEventListener("click", function (event) {
      event.preventDefault();
      var current = getAccount();
      if (!current) { window.location.href = "profil.html"; return; }
      var next = Object.assign({}, current, { favorites: current.favorites.slice() });
      var index = next.favorites.indexOf(slug);
      if (index === -1) next.favorites.push(slug); else next.favorites.splice(index, 1);
      favBtn.disabled = true;
      saveAccount(next).then(function (result) {
        favBtn.disabled = false;
        if (result.error) window.alert(result.error);
        renderFav();
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();
})();
