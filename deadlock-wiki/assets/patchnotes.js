(function () {
  "use strict";

  var EFFECTS = {
    buff: { label: "Buff", symbol: "↑" },
    nerf: { label: "Nerf", symbol: "↓" },
    rework: { label: "Rework", symbol: "↻" },
    adjustment: { label: "Anpassung", symbol: "±" },
    "new": { label: "Neu", symbol: "★" }
  };

  function element(name, className, text) {
    var node = document.createElement(name);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function entityHref(change) {
    if (change.entityType === "hero") return change.slug + ".html";
    if (change.entityType === "item") return "items.html?q=" + encodeURIComponent(change.name);
    return "";
  }

  function createEntityIcon(change) {
    var wrap = element("span", "patch-entity-icon patch-entity-icon--" + change.entityType);

    if (change.entityType === "hero" || change.entityType === "item") {
      var image = document.createElement("img");
      image.src = change.entityType === "hero"
        ? "assets/heroes/sm/" + change.slug + ".webp"
        : "assets/items/" + change.slug + ".webp";
      image.alt = "";
      image.loading = "lazy";
      image.width = 52;
      image.height = 52;
      image.addEventListener("error", function () {
        wrap.classList.add("patch-entity-icon--fallback");
        wrap.textContent = change.name.slice(0, 2).toUpperCase();
      }, { once: true });
      wrap.appendChild(image);
    } else {
      wrap.textContent = change.iconText || change.name.slice(0, 2).toUpperCase();
    }

    return wrap;
  }

  function createChangeCard(change, compact) {
    var effect = EFFECTS[change.effect] || EFFECTS.adjustment;
    var card = element("article", "patch-change-card patch-change-card--" + change.effect);
    if (compact) card.classList.add("patch-change-card--compact");

    card.appendChild(createEntityIcon(change));

    var body = element("div", "patch-change-body");
    var head = element("div", "patch-change-head");
    var href = entityHref(change);
    var title = href ? element("a", "patch-change-name", change.name) : element("span", "patch-change-name", change.name);
    if (href) title.href = href;
    head.appendChild(title);

    var badge = element("span", "patch-effect patch-effect--" + change.effect);
    badge.appendChild(element("span", "patch-effect-symbol", effect.symbol));
    badge.appendChild(document.createTextNode(" " + effect.label));
    head.appendChild(badge);
    body.appendChild(head);
    body.appendChild(element("p", "patch-change-summary", change.summary));
    card.appendChild(body);
    return card;
  }

  function createChangeGrid(changes, compact) {
    var grid = element("div", "patch-change-grid");
    changes.forEach(function (change) {
      grid.appendChild(createChangeCard(change, compact));
    });
    return grid;
  }

  function createPatchCard(patch, featured) {
    var card = element("article", "patch-card" + (featured ? " patch-card--featured" : ""));
    card.id = patch.id;
    card.dataset.date = patch.date;
    card.dataset.category = patch.categories.join(" ");

    var header = element("header", "patch-card-head");
    var titleGroup = document.createElement("div");
    titleGroup.appendChild(element("p", "patch-kicker", patch.kicker));
    titleGroup.appendChild(element("h2", "", patch.displayDate));
    header.appendChild(titleGroup);
    var time = element("time", "", patch.shortDate);
    time.dateTime = patch.date;
    header.appendChild(time);
    card.appendChild(header);

    var tags = element("div", "patch-tags");
    tags.setAttribute("aria-label", "Kategorien");
    patch.tags.forEach(function (tag) { tags.appendChild(element("span", "", tag)); });
    card.appendChild(tags);
    card.appendChild(element("p", "patch-summary", patch.summary));

    if (patch.changes && patch.changes.length) {
      card.appendChild(element("p", "patch-change-label", patch.changeSummary || "Die wichtigsten Änderungen"));
      card.appendChild(createChangeGrid(patch.changes, false));
    }

    if (patch.highlights && patch.highlights.length) {
      var highlights = element("ul", "patch-highlights");
      patch.highlights.forEach(function (highlight) {
        highlights.appendChild(element("li", "", highlight));
      });
      card.appendChild(highlights);
    }

    var source = element("a", "patch-source", patch.sourceLabel + " ");
    source.href = patch.source;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    var arrow = element("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    source.appendChild(arrow);
    card.appendChild(source);
    return card;
  }

  function setupTimeline(patches) {
    var timeline = document.getElementById("patch-timeline");
    if (!timeline) return;

    timeline.replaceChildren();
    patches.forEach(function (patch, index) {
      timeline.appendChild(createPatchCard(patch, index === 0));
    });
    timeline.removeAttribute("aria-busy");

    var cards = Array.prototype.slice.call(timeline.querySelectorAll(".patch-card"));
    var filters = Array.prototype.slice.call(document.querySelectorAll("[data-filter]"));
    var sort = document.getElementById("patch-sort");
    var empty = document.getElementById("patch-empty");
    var status = document.getElementById("patch-status");
    var activeFilter = "all";

    function render() {
      var visible = 0;
      cards.sort(function (a, b) {
        var direction = sort && sort.value === "oldest" ? 1 : -1;
        return a.dataset.date.localeCompare(b.dataset.date) * direction;
      }).forEach(function (card) {
        var categories = card.dataset.category.split(" ");
        var show = activeFilter === "all" || categories.indexOf(activeFilter) !== -1;
        card.hidden = !show;
        if (show) visible += 1;
        timeline.appendChild(card);
      });
      if (empty) empty.hidden = visible !== 0;
      if (status) status.textContent = visible + (visible === 1 ? " Eintrag angezeigt." : " Einträge angezeigt.");
    }

    filters.forEach(function (button) {
      button.addEventListener("click", function () {
        activeFilter = button.dataset.filter;
        filters.forEach(function (item) {
          item.setAttribute("aria-pressed", String(item === button));
        });
        render();
      });
    });
    if (sort) sort.addEventListener("change", render);
    render();

    if (window.location.hash) {
      window.requestAnimationFrame(function () {
        var target = document.getElementById(window.location.hash.slice(1));
        if (target) target.scrollIntoView({ block: "start" });
      });
    }
  }

  function setupHomepage(patches) {
    var preview = document.getElementById("latest-patch-preview");
    if (!preview) return;

    var latest = patches.find(function (patch) { return patch.homepage; }) || patches[0];
    var latestItemPatch = patches.find(function (patch) {
      return patch.changes && patch.changes.some(function (change) { return change.entityType === "item"; });
    });

    preview.replaceChildren();
    preview.removeAttribute("aria-busy");
    var intro = element("div", "home-patch-intro");
    var meta = element("p", "patch-kicker", latest.kicker + " · " + latest.displayDate);
    intro.appendChild(meta);
    intro.appendChild(element("p", "home-patch-summary", latest.summary));
    preview.appendChild(intro);
    preview.appendChild(createChangeGrid(latest.changes.slice(0, 4), true));

    if (latestItemPatch && latestItemPatch.id !== latest.id) {
      preview.appendChild(element("h3", "home-patch-subtitle", "Letzte Item-Änderungen · " + latestItemPatch.displayDate));
      var itemChanges = latestItemPatch.changes.filter(function (change) {
        return change.entityType === "item";
      }).slice(0, 3);
      preview.appendChild(createChangeGrid(itemChanges, true));
    }

    var actions = element("div", "home-patch-actions");
    var full = element("a", "btn btn--solid", "Alle Änderungen ansehen");
    full.href = "patchnotes.html#" + latest.id;
    actions.appendChild(full);
    var original = element("a", "btn btn--ghost", "Valve-Original ↗");
    original.href = latest.source;
    original.target = "_blank";
    original.rel = "noopener noreferrer";
    actions.appendChild(original);
    preview.appendChild(actions);
  }

  function setupRecentList(patches) {
    var list = document.getElementById("recent-patch-list");
    if (!list) return;
    list.replaceChildren();
    patches.slice(0, 3).forEach(function (patch) {
      var item = document.createElement("li");
      var link = element("a", "", patch.kicker);
      link.href = "patchnotes.html#" + patch.id;
      item.appendChild(link);
      item.appendChild(element("span", "patch-date", patch.displayDate));
      list.appendChild(item);
    });
  }

  function showLoadError(error) {
    ["patch-timeline", "latest-patch-preview"].forEach(function (id) {
      var target = document.getElementById(id);
      if (!target) return;
      target.removeAttribute("aria-busy");
      target.replaceChildren();
      var message = element("p", "patch-load-error", "Die Patchdaten konnten gerade nicht geladen werden. ");
      var link = element("a", "", "Zum offiziellen Valve-Changelog");
      link.href = "https://forums.playdeadlock.com/forums/changelog.10/";
      message.appendChild(link);
      target.appendChild(message);
    });
    if (window.console && console.error) console.error("Patchdaten konnten nicht geladen werden", error);
  }

  fetch("assets/patches.json?v=20260819-patch1", { credentials: "same-origin" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (data) {
      document.querySelectorAll("[data-patch-updated]").forEach(function (node) {
        node.textContent = "Stand: " + data.updatedLabel + ".";
      });
      setupTimeline(data.patches);
      setupHomepage(data.patches);
      setupRecentList(data.patches);
    })
    .catch(showLoadError);
})();
