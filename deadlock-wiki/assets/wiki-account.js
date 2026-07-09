/* Deadlock Wiki – Browser-Konto
   Das Konto lebt komplett im localStorage dieses Browsers; es gibt keinen
   Server. Die Deadlock-Verknüpfung holt öffentliche Match-Daten über die
   Community-API (api.deadlock-api.com). */
(function () {
  "use strict";

  var KEY = "dlwiki_account";
  var SESSION = "dlwiki_session";

  function getAccount() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function saveAccount(acc) {
    localStorage.setItem(KEY, JSON.stringify(acc));
  }
  function isLoggedIn() {
    return !!getAccount() && localStorage.getItem(SESSION) === "1";
  }
  function login() { localStorage.setItem(SESSION, "1"); }
  function logout() { localStorage.removeItem(SESSION); }
  function deleteAccount() {
    localStorage.removeItem(KEY);
    localStorage.removeItem(SESSION);
  }

  window.DLWiki = {
    getAccount: getAccount,
    saveAccount: saveAccount,
    isLoggedIn: isLoggedIn,
    login: login,
    logout: logout,
    deleteAccount: deleteAccount
  };

  document.addEventListener("DOMContentLoaded", function () {
    // Navigations-Chip: Anmelden vs. Profil
    var navLink = document.querySelector("[data-nav-account]");
    if (navLink) {
      var acc = getAccount();
      if (acc && isLoggedIn()) {
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

    // Favoriten-Knöpfe auf Heldenseiten
    var favBtn = document.querySelector("[data-fav-hero]");
    if (favBtn) {
      var slug = favBtn.getAttribute("data-fav-hero");
      function renderFav() {
        var acc = getAccount();
        var faved = acc && isLoggedIn() && (acc.favorites || []).indexOf(slug) !== -1;
        favBtn.textContent = faved ? "★ Favorit" : "☆ Favorit";
        favBtn.setAttribute("data-faved", faved ? "true" : "false");
        favBtn.classList.add("fav-btn");
      }
      renderFav();
      favBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var acc = getAccount();
        if (!acc || !isLoggedIn()) {
          window.location.href = "profil.html";
          return;
        }
        acc.favorites = acc.favorites || [];
        var i = acc.favorites.indexOf(slug);
        if (i === -1) acc.favorites.push(slug); else acc.favorites.splice(i, 1);
        saveAccount(acc);
        renderFav();
      });
    }
  });
})();
