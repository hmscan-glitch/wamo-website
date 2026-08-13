(function () {
  "use strict";

  function setupNavigation() {
    var nav = document.querySelector(".localnav");
    var inner = nav && nav.querySelector(".localnav-inner");
    if (!nav || !inner || nav.querySelector(".nav-toggle")) return;

    if (!inner.id) inner.id = "wiki-navigation-links";

    var current = inner.querySelector('[aria-current="page"]');
    var currentLabel = current ? (current.matches("[data-nav-account]") ? "Profil" : current.textContent.trim()) : "Wiki";
    var toggle = document.createElement("button");
    toggle.className = "nav-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", inner.id);
    toggle.innerHTML =
      '<span class="nav-toggle-label">Menü</span>' +
      '<span class="nav-toggle-current"></span>' +
      '<span class="nav-toggle-icon" aria-hidden="true"><span></span><span></span></span>';
    toggle.querySelector(".nav-toggle-current").textContent = currentLabel;

    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", (open ? "Wiki-Menü schließen" : "Wiki-Menü öffnen") + " — Aktuell: " + currentLabel);
    }

    nav.classList.add("has-menu");
    nav.insertBefore(toggle, inner);
    setOpen(false);
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    inner.addEventListener("click", function (event) {
      if (event.target.closest("a") && window.matchMedia("(max-width: 1080px)").matches) setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    document.addEventListener("click", function (event) {
      if (nav.classList.contains("is-open") && !nav.contains(event.target)) setOpen(false);
    });

    var media = window.matchMedia("(max-width: 1080px)");
    if (media.addEventListener) {
      media.addEventListener("change", function (event) {
        if (!event.matches) setOpen(false);
      });
    } else if (media.addListener) {
      media.addListener(function (event) {
        if (!event.matches) setOpen(false);
      });
    }
  }

  function setupInfobox(infobox, index) {
    var sections = infobox.querySelectorAll(":scope > .infobox-section");
    var primaryData = sections[0] && sections[0].nextElementSibling;
    var firstDetail = sections[1];
    if (!firstDetail || !primaryData || primaryData.tagName !== "DL" || infobox.querySelector(":scope > .infobox-details")) return;

    sections[0].classList.add("infobox-primary-label");
    primaryData.classList.add("infobox-primary-data");

    var details = document.createElement("div");
    details.className = "infobox-details";
    details.id = "infobox-details-" + (index + 1);

    var node = firstDetail;
    while (node) {
      var next = node.nextSibling;
      details.appendChild(node);
      node = next;
    }

    var toggle = document.createElement("button");
    toggle.className = "infobox-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-controls", details.id);
    toggle.setAttribute("aria-expanded", "false");

    var open = false;
    var media = window.matchMedia("(max-width: 760px)");
    function render() {
      var collapsed = media.matches && !open;
      details.hidden = collapsed;
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.textContent = collapsed ? "Steckbrief anzeigen" : "Steckbrief verbergen";
      infobox.classList.toggle("is-details-open", !collapsed);
    }

    toggle.addEventListener("click", function () {
      open = details.hidden;
      render();
    });
    if (media.addEventListener) media.addEventListener("change", render);
    else if (media.addListener) media.addListener(render);

    infobox.classList.add("js-collapsible");
    infobox.appendChild(toggle);
    infobox.appendChild(details);
    render();
  }

  function init() {
    setupNavigation();
    Array.prototype.forEach.call(document.querySelectorAll(".infobox"), setupInfobox);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
