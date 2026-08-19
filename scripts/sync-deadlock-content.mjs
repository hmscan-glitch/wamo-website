import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const wikiRoot = resolve(repositoryRoot, "deadlock-wiki");
const patchesPath = resolve(wikiRoot, "assets", "patches.json");
const heroesPath = resolve(wikiRoot, "assets", "heroes.json");
const itemsPath = resolve(wikiRoot, "assets", "items", "items.json");
const pendingRosterPath = resolve(wikiRoot, "assets", "pending-roster.json");

const steamNewsUrl =
  "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1422450&count=30&maxlength=0&feeds=steam_community_announcements";
const heroesApiUrl =
  "https://api.deadlock-api.com/v1/assets/heroes?only_active=true&language=german";

const validationOnly = process.argv.includes("--validate-only");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const normalizeName = (value = "") =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();

const extractAnnouncementId = (value = "") => value.match(/(\d{12,})\/?$/)?.[1] ?? "";

const formatGermanDate = (date) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

const formatShortDate = (date) => {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
};

const stripSteamMarkup = (contents = "") =>
  contents
    .replace(/\[url=[^\]]+\]([\s\S]*?)\[\/url\]/gi, "$1")
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "");

const buildEntityLookup = (entities) => {
  const lookup = new Map();
  for (const entity of entities) {
    lookup.set(normalizeName(entity.name), entity);
  }
  return lookup;
};

const findEntityChanges = (contents, heroes, items) => {
  const heroLookup = buildEntityLookup(heroes);
  const itemLookup = buildEntityLookup(items);
  const grouped = new Map();
  const text = stripSteamMarkup(contents);

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(/^[-*]\s*([^:]{2,60}):\s*(.+)$/);
    if (!match) continue;

    const heading = normalizeName(match[1]);
    const hero = heroLookup.get(heading);
    const item = itemLookup.get(heading);
    const entity = hero ?? item;
    if (!entity) continue;

    const entityType = hero ? "hero" : "item";
    const key = `${entityType}:${entity.slug}`;
    if (!grouped.has(key)) {
      grouped.set(key, { entityType, entity, lines: [] });
    }
    grouped.get(key).lines.push(match[2].trim());
  }

  return [...grouped.values()];
};

const makeChangeCard = ({ entityType, entity, lines }) => ({
  entityType,
  slug: entity.slug,
  name: entity.name,
  // Natural-language direction can be ambiguous (for example, an increased
  // damage penalty is a nerf). Keep generated cards neutral until the draft
  // pull request has been checked by a person.
  effect: "adjustment",
  summary: `${lines.length} ${lines.length === 1 ? "Änderung" : "Änderungen"} in diesem Update. Die genauen Werte stehen in Valves Original-Patchnotes.`,
});

const isRelevantUpdate = (item) => {
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => tag.toLowerCase()) : [];
  return tags.includes("patchnotes") || /(?:minor|major|matchmaking|gameplay|balance)\s+update|patch/i.test(item.title ?? "");
};

const makePatch = (newsItem, heroes, items) => {
  const date = new Date(newsItem.date * 1000).toISOString().slice(0, 10);
  const affected = findEntityChanges(newsItem.contents, heroes, items);
  const changes = affected.map(makeChangeCard);
  const heroCount = changes.filter((change) => change.entityType === "hero").length;
  const itemCount = changes.filter((change) => change.entityType === "item").length;
  const categories = [];
  if (heroCount) categories.push("heroes");
  if (itemCount) categories.push("items");
  if (!categories.length) categories.push("systems");

  if (!changes.length) {
    changes.push({
      entityType: "system",
      slug: "system-update",
      name: "Spielsysteme",
      effect: "adjustment",
      summary: "Dieses offizielle Update enthält System- oder Gameplay-Änderungen. Details stehen in Valves Original-Patchnotes.",
    });
  }

  const parts = [];
  if (heroCount) parts.push(`${heroCount} ${heroCount === 1 ? "Held" : "Helden"}`);
  if (itemCount) parts.push(`${itemCount} ${itemCount === 1 ? "Item" : "Items"}`);
  const detected = parts.length ? parts.join(" und ") : "Systemänderungen";

  return {
    id: `patch-${date}-${newsItem.gid}`,
    date,
    displayDate: formatGermanDate(date),
    shortDate: formatShortDate(date),
    kicker: (newsItem.title ?? "Offizielles Update").replace(/\s+-\s+\d{2}-\d{2}-\d{4}\s*$/, ""),
    summary: `Automatisch aus Valves offiziellen Patchnotes erkannt: ${detected}. Bitte die Zuordnung vor dem Merge des Update-PRs kurz prüfen.`,
    source: newsItem.url,
    sourceLabel: "Offizielle Patchnotes bei Steam",
    categories,
    tags: [...(heroCount ? ["Helden"] : []), ...(itemCount ? ["Items"] : []), "Automatisch erkannt"],
    featured: true,
    homepage: true,
    autoGenerated: true,
    sourceId: String(newsItem.gid),
    changeSummary: `${changes.length} automatisch erkannte Änderungen`,
    changes,
  };
};

const validateContent = ({ patchData, heroes, items }) => {
  const errors = [];
  const heroSlugs = new Set(heroes.map((hero) => hero.slug));
  const itemSlugs = new Set(items.map((item) => item.slug));
  const patchIds = new Set();

  if (!Array.isArray(patchData.patches) || !patchData.patches.length) {
    errors.push("patches.json enthält keine Patches.");
  }

  for (const patch of patchData.patches ?? []) {
    if (patchIds.has(patch.id)) errors.push(`Doppelte Patch-ID: ${patch.id}`);
    patchIds.add(patch.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date ?? "")) {
      errors.push(`Ungültiges Datum bei ${patch.id}`);
    }
    for (const change of patch.changes ?? []) {
      if (change.entityType === "hero" && !heroSlugs.has(change.slug)) {
        errors.push(`Unbekannter Held ${change.slug} in ${patch.id}`);
      }
      if (change.entityType === "item" && !itemSlugs.has(change.slug)) {
        errors.push(`Unbekanntes Item ${change.slug} in ${patch.id}`);
      }
      if (!["buff", "nerf", "rework", "adjustment", "new"].includes(change.effect)) {
        errors.push(`Unbekannter Änderungstyp ${change.effect} in ${patch.id}`);
      }
    }
  }

  if (errors.length) throw new Error(errors.join("\n"));
};

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { "user-agent": "wamo-deadlock-wiki-sync/1.0" },
  });
  if (!response.ok) throw new Error(`${url} antwortete mit HTTP ${response.status}`);
  return response.json();
};

const syncPatches = async (patchData, heroes, items) => {
  const payload = await fetchJson(steamNewsUrl);
  const newsItems = payload?.appnews?.newsitems;
  if (!Array.isArray(newsItems)) throw new Error("Valves News-Feed hat ein unerwartetes Format.");

  const existingSourceIds = new Set(
    patchData.patches.flatMap((patch) => {
      const values = [patch.sourceId, extractAnnouncementId(patch.source)].filter(Boolean);
      return values.map(String);
    }),
  );
  const newestKnownDate = patchData.patches.reduce(
    (latest, patch) => (patch.date > latest ? patch.date : latest),
    "0000-00-00",
  );

  const unseen = newsItems.filter((item) => {
    if (!isRelevantUpdate(item)) return false;
    const date = new Date(item.date * 1000).toISOString().slice(0, 10);
    return date >= newestKnownDate && !existingSourceIds.has(String(item.gid));
  });

  if (!unseen.length) return false;

  const additions = unseen.map((item) => makePatch(item, heroes, items));
  patchData.patches = [...additions, ...patchData.patches].sort((a, b) =>
    b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
  const today = new Date().toISOString().slice(0, 10);
  patchData.updated = today;
  patchData.updatedLabel = formatGermanDate(today);
  await writeFile(patchesPath, `${JSON.stringify(patchData, null, 2)}\n`, "utf8");
  console.log(`${additions.length} neues offizielles Update vorbereitet.`);
  return true;
};

const syncPendingHeroes = async (localHeroes) => {
  let payload;
  try {
    payload = await fetchJson(heroesApiUrl);
  } catch (error) {
    console.warn(`Helden-Abgleich übersprungen: ${error.message}`);
    return false;
  }

  const remoteHeroes = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(remoteHeroes)) {
    console.warn("Helden-Abgleich übersprungen: unerwartetes API-Format.");
    return false;
  }

  const knownNames = new Set(localHeroes.map((hero) => normalizeName(hero.name)));
  const newHeroes = remoteHeroes
    .filter((hero) => hero?.player_selectable && !hero?.disabled && !hero?.in_development)
    .filter((hero) => !knownNames.has(normalizeName(hero.name)))
    .map((hero) => ({
      name: hero.name,
      className: hero.class_name,
      description: hero.description?.role ?? hero.description?.lore ?? "",
      images: {
        small: hero.images?.icon_hero_card ?? hero.images?.icon_hero_card_webp ?? "",
        card: hero.images?.selection_image ?? hero.images?.selection_image_webp ?? "",
      },
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const next = { newHeroes };
  let current = { newHeroes: [] };
  try {
    current = await readJson(pendingRosterPath);
  } catch {
    // The initial file is created below when needed.
  }

  if (JSON.stringify(current) === JSON.stringify(next)) return false;
  await writeFile(pendingRosterPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`${newHeroes.length} neue Helden zur Prüfung vorgemerkt.`);
  return true;
};

const main = async () => {
  const [patchData, heroes, items] = await Promise.all([
    readJson(patchesPath),
    readJson(heroesPath),
    readJson(itemsPath),
  ]);

  validateContent({ patchData, heroes, items });
  if (validationOnly) {
    console.log(`Validierung erfolgreich: ${patchData.patches.length} Patches, ${heroes.length} Helden, ${items.length} Items.`);
    return;
  }

  const [patchesChanged, rosterChanged] = await Promise.all([
    syncPatches(patchData, heroes, items),
    syncPendingHeroes(heroes),
  ]);

  if (!patchesChanged && !rosterChanged) console.log("Deadlock-Inhalte sind bereits aktuell.");
};

await main();
