const SUPABASE_URL = "https://pyuafykqrmcfwwzvsgxh.supabase.co";
// Dieser Publishable Key ist ausdrücklich für die Nutzung im Browser bestimmt.
// Schreibzugriffe werden zusätzlich durch Supabase Auth, RLS und die RPCs geschützt.
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ByvOk_7SWDY_r_OJO1oAVA_-3MvFmMq";
const AUTH_STORAGE_KEY = "dlwiki-supabase-auth";
const REGISTRATION_ENABLED = false;
const COMMUNITY_WRITES_ENABLED = false;

const communityClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: AUTH_STORAGE_KEY
  }
});

const elements = {
  alert: document.getElementById("community-alert"),
  session: document.getElementById("community-session"),
  authLoading: document.getElementById("community-auth-loading"),
  signedOut: document.getElementById("community-signed-out"),
  unconfirmed: document.getElementById("community-unconfirmed"),
  composeForm: document.getElementById("community-compose-form"),
  content: document.getElementById("community-content"),
  contentCount: document.getElementById("community-content-count"),
  submit: document.getElementById("community-submit"),
  refresh: document.getElementById("community-refresh"),
  retry: document.getElementById("community-retry"),
  feedStatus: document.getElementById("community-feed-status"),
  feedError: document.getElementById("community-feed-error"),
  empty: document.getElementById("community-empty"),
  postList: document.getElementById("community-post-list"),
  editDialog: document.getElementById("community-edit-dialog"),
  editForm: document.getElementById("community-edit-form"),
  editContent: document.getElementById("community-edit-content"),
  editCount: document.getElementById("community-edit-count"),
  editSubmit: document.getElementById("community-edit-submit"),
  reportDialog: document.getElementById("community-report-dialog"),
  reportForm: document.getElementById("community-report-form"),
  reportReason: document.getElementById("community-report-reason"),
  reportDetails: document.getElementById("community-report-details"),
  reportCount: document.getElementById("community-report-count"),
  reportSubmit: document.getElementById("community-report-submit")
};

const state = {
  user: null,
  posts: [],
  editPostId: null,
  reportPostId: null,
  alertTimer: null,
  loadRequestId: 0,
  authGeneration: 0
};

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short"
});

function isConfirmed(user) {
  return Boolean(user && (user.email_confirmed_at || user.confirmed_at));
}

function setHidden(element, hidden) {
  element.hidden = hidden;
}

function updateCounter(input, output, maximum) {
  output.value = `${input.value.length} / ${maximum}`;
  output.textContent = output.value;
}

function showAlert(message, type = "success") {
  window.clearTimeout(state.alertTimer);
  elements.alert.textContent = message;
  elements.alert.className = `community-alert community-alert--${type}`;
  elements.alert.hidden = false;
  state.alertTimer = window.setTimeout(() => {
    elements.alert.hidden = true;
  }, 7000);
}

function knownError(error, fallback) {
  const message = String(error && error.message ? error.message : "");
  const allowedMessages = [
    "Bitte melde dich an.",
    "Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.",
    "Bitte bestätige zuerst deine E-Mail-Adresse.",
    "Der Beitrag muss zwischen 1 und 1000 Zeichen lang sein.",
    "Bitte warte kurz, bevor du einen weiteren Beitrag veröffentlichst.",
    "Du hast das stündliche Beitragslimit erreicht.",
    "Der Beitrag wurde nicht gefunden oder gehört nicht dir.",
    "Bitte warte kurz, bevor du erneut speicherst.",
    "Du kannst deinen eigenen Beitrag nicht melden.",
    "Du hast diesen Beitrag bereits gemeldet.",
    "Du hast das stündliche Meldelimit erreicht.",
    "Der Meldegrund muss zwischen 1 und 300 Zeichen lang sein.",
    "Dieser Beitrag kann nicht gemeldet werden."
  ];
  return allowedMessages.find((entry) => message.includes(entry)) || fallback;
}

function setButtonBusy(button, busy, busyText) {
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.defaultLabel;
}

function setAuthState(session) {
  const previousUserId = state.user ? state.user.id : null;
  const nextUser = session && session.user ? session.user : null;
  const nextUserId = nextUser ? nextUser.id : null;
  const identityChanged = previousUserId !== nextUserId;
  state.user = nextUser;
  if (identityChanged) {
    state.authGeneration += 1;
    resetPrivateDrafts();
  }
  const confirmed = isConfirmed(state.user);

  setHidden(elements.authLoading, true);
  setHidden(elements.signedOut, Boolean(state.user));
  setHidden(elements.unconfirmed, !state.user || confirmed);
  setHidden(elements.composeForm, !confirmed || !COMMUNITY_WRITES_ENABLED);

  if (!REGISTRATION_ENABLED && !state.user) {
    const gateText = elements.signedOut.querySelector("p");
    const gateLink = elements.signedOut.querySelector("a");
    if (gateText) gateText.textContent = "Das Kontosystem befindet sich noch in einer geschlossenen technischen Testphase. Lesen ist weiterhin ohne Anmeldung möglich.";
    if (gateLink) gateLink.hidden = true;
  }

  if (!state.user) {
    elements.session.textContent = "Nicht angemeldet";
  } else if (!confirmed) {
    elements.session.textContent = "E-Mail noch nicht bestätigt";
  } else if (!COMMUNITY_WRITES_ENABLED) {
    elements.session.textContent = "Schreiben vorübergehend pausiert";
  } else {
    elements.session.textContent = "Sicher angemeldet";
  }

  document.querySelectorAll("[data-nav-account]").forEach((link) => {
    link.textContent = state.user ? "Profil" : "Anmelden";
  });

  if (identityChanged) {
    state.posts = [];
    renderPosts();
    loadPosts();
  } else {
    renderPosts();
  }
}

function profileName(post) {
  return post.display_name || "Mitglied";
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (typeof text === "string") element.textContent = text;
  return element;
}

function makeAction(action, label, postId, danger = false) {
  const button = makeElement("button", `community-action${danger ? " community-action--danger" : ""}`, label);
  button.type = "button";
  button.dataset.action = action;
  button.dataset.postId = postId;
  return button;
}

function renderPost(post) {
  const item = makeElement("li", "community-post-item");
  const article = makeElement("article", "community-post");
  const header = makeElement("header", "community-post-head");
  const identity = makeElement("div", "community-post-identity");
  const name = profileName(post);
  const avatar = makeElement("span", "community-avatar", name.trim().charAt(0).toLocaleUpperCase("de-DE") || "M");
  avatar.setAttribute("aria-hidden", "true");
  if (/^[a-z0-9-]{1,40}$/.test(post.avatar || "")) {
    const avatarImage = document.createElement("img");
    avatarImage.src = `assets/heroes/sm/${post.avatar}.webp`;
    avatarImage.alt = "";
    avatarImage.addEventListener("load", () => { avatar.textContent = ""; avatar.append(avatarImage); }, { once: true });
  }
  const authorInfo = makeElement("div", "community-author-info");
  const author = makeElement("strong", "community-author", name);
  const meta = makeElement("div", "community-post-meta");
  const time = makeElement("time", "", dateFormatter.format(new Date(post.created_at)));
  time.dateTime = post.created_at;
  time.title = new Date(post.created_at).toLocaleString("de-DE");
  meta.append(time);

  const edited = Math.abs(new Date(post.updated_at) - new Date(post.created_at)) > 1000;
  if (edited) meta.append(makeElement("span", "community-edited", "bearbeitet"));

  authorInfo.append(author, meta);
  identity.append(avatar, authorInfo);
  header.append(identity);

  const content = makeElement("p", "community-post-content", post.content);
  const actions = makeElement("div", "community-post-actions");
  const ownsPost = Boolean(COMMUNITY_WRITES_ENABLED && state.user && post.is_owner);

  if (ownsPost) {
    actions.append(
      makeAction("edit", "Bearbeiten", post.id),
      makeAction("delete", "Löschen", post.id, true)
    );
  } else if (COMMUNITY_WRITES_ENABLED && isConfirmed(state.user)) {
    actions.append(makeAction("report", "Melden", post.id));
  }

  article.append(header, content);
  if (actions.childElementCount) article.append(actions);
  item.append(article);
  return item;
}

function renderPosts() {
  elements.postList.replaceChildren(...state.posts.map(renderPost));
}

function resetPrivateDrafts() {
  elements.composeForm.reset();
  elements.editForm.reset();
  elements.reportForm.reset();
  state.editPostId = null;
  state.reportPostId = null;
  closeDialog("community-edit-dialog");
  closeDialog("community-report-dialog");
  setButtonBusy(elements.submit, false, "");
  setButtonBusy(elements.editSubmit, false, "");
  setButtonBusy(elements.reportSubmit, false, "");
  updateCounter(elements.content, elements.contentCount, 1000);
  updateCounter(elements.editContent, elements.editCount, 1000);
  updateCounter(elements.reportDetails, elements.reportCount, 240);
}

async function loadPosts() {
  const requestId = ++state.loadRequestId;
  elements.refresh.disabled = true;
  elements.feedStatus.hidden = false;
  elements.feedStatus.textContent = "Beiträge werden geladen …";
  elements.feedError.hidden = true;
  elements.empty.hidden = true;
  elements.postList.hidden = true;

  const { data, error } = await communityClient.rpc("get_community_posts", {
    p_limit: 50,
    p_offset: 0
  });

  if (requestId !== state.loadRequestId) return;

  elements.refresh.disabled = false;

  if (error) {
    console.error("Community-Beiträge konnten nicht geladen werden.", error);
    state.posts = [];
    elements.feedStatus.hidden = true;
    elements.feedError.hidden = false;
    return;
  }

  state.posts = data || [];
  renderPosts();
  elements.feedStatus.textContent = state.posts.length === 1
    ? "1 Beitrag wird angezeigt."
    : `${state.posts.length} Beiträge werden angezeigt.`;
  elements.empty.hidden = state.posts.length !== 0;
  elements.postList.hidden = state.posts.length === 0;
}

async function createPost(event) {
  event.preventDefault();
  if (!COMMUNITY_WRITES_ENABLED) {
    showAlert("Schreiben ist während der technischen Testphase noch pausiert.", "error");
    return;
  }
  const actionGeneration = state.authGeneration;
  const expectedUserId = state.user && state.user.id;
  const content = elements.content.value.trim();
  if (!content || content.length > 1000) {
    showAlert("Der Beitrag muss zwischen 1 und 1000 Zeichen lang sein.", "error");
    elements.content.focus();
    return;
  }

  setButtonBusy(elements.submit, true, "Wird veröffentlicht …");
  const { error } = await communityClient.rpc("create_community_post", {
    p_content: content,
    p_expected_user_id: expectedUserId
  });
  if (actionGeneration !== state.authGeneration) return;
  setButtonBusy(elements.submit, false, "");

  if (error) {
    showAlert(knownError(error, "Der Beitrag konnte nicht veröffentlicht werden. Bitte versuche es erneut."), "error");
    return;
  }

  elements.composeForm.reset();
  updateCounter(elements.content, elements.contentCount, 1000);
  showAlert("Dein Beitrag wurde veröffentlicht.");
  await loadPosts();
}

function openEditDialog(postId) {
  if (!COMMUNITY_WRITES_ENABLED) return;
  const post = state.posts.find((entry) => entry.id === postId);
  if (!post || !state.user || !post.is_owner) return;
  state.editPostId = postId;
  elements.editContent.value = post.content;
  updateCounter(elements.editContent, elements.editCount, 1000);
  elements.editDialog.showModal();
  elements.editContent.focus();
}

async function updatePost(event) {
  event.preventDefault();
  if (!COMMUNITY_WRITES_ENABLED) {
    showAlert("Schreiben ist während der technischen Testphase noch pausiert.", "error");
    return;
  }
  const actionGeneration = state.authGeneration;
  const expectedUserId = state.user && state.user.id;
  const content = elements.editContent.value.trim();
  if (!state.editPostId || !content || content.length > 1000) {
    showAlert("Der Beitrag muss zwischen 1 und 1000 Zeichen lang sein.", "error");
    elements.editContent.focus();
    return;
  }

  setButtonBusy(elements.editSubmit, true, "Wird gespeichert …");
  const { error } = await communityClient.rpc("update_community_post", {
    p_post_id: state.editPostId,
    p_content: content,
    p_expected_user_id: expectedUserId
  });
  if (actionGeneration !== state.authGeneration) return;
  setButtonBusy(elements.editSubmit, false, "");

  if (error) {
    showAlert(knownError(error, "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut."), "error");
    return;
  }

  elements.editDialog.close();
  state.editPostId = null;
  showAlert("Dein Beitrag wurde aktualisiert.");
  await loadPosts();
}

async function deletePost(postId) {
  if (!COMMUNITY_WRITES_ENABLED) return;
  const post = state.posts.find((entry) => entry.id === postId);
  if (!post || !state.user || !post.is_owner) return;
  if (!window.confirm("Möchtest du diesen Beitrag wirklich dauerhaft löschen?")) return;
  const actionGeneration = state.authGeneration;
  const expectedUserId = state.user && state.user.id;

  const { error } = await communityClient.rpc("delete_community_post", {
    p_post_id: postId,
    p_expected_user_id: expectedUserId
  });
  if (actionGeneration !== state.authGeneration) return;
  if (error) {
    showAlert(knownError(error, "Der Beitrag konnte nicht gelöscht werden. Bitte versuche es erneut."), "error");
    return;
  }

  showAlert("Dein Beitrag wurde gelöscht.");
  await loadPosts();
}

function openReportDialog(postId) {
  if (!COMMUNITY_WRITES_ENABLED) return;
  const post = state.posts.find((entry) => entry.id === postId);
  if (!post || !isConfirmed(state.user) || post.is_owner) return;
  state.reportPostId = postId;
  elements.reportForm.reset();
  updateCounter(elements.reportDetails, elements.reportCount, 240);
  elements.reportDialog.showModal();
  elements.reportReason.focus();
}

async function reportPost(event) {
  event.preventDefault();
  if (!COMMUNITY_WRITES_ENABLED) {
    showAlert("Meldungen sind während der technischen Testphase noch pausiert.", "error");
    return;
  }
  const actionGeneration = state.authGeneration;
  const expectedUserId = state.user && state.user.id;
  const reason = elements.reportReason.value;
  const details = elements.reportDetails.value.trim();
  const fullReason = details ? `${reason}: ${details}` : reason;
  if (!state.reportPostId || !reason || fullReason.length > 300) {
    showAlert("Bitte wähle einen gültigen Meldegrund aus.", "error");
    elements.reportReason.focus();
    return;
  }

  setButtonBusy(elements.reportSubmit, true, "Wird gesendet …");
  const { error } = await communityClient.rpc("report_community_post", {
    p_post_id: state.reportPostId,
    p_reason: fullReason,
    p_expected_user_id: expectedUserId
  });
  if (actionGeneration !== state.authGeneration) return;
  setButtonBusy(elements.reportSubmit, false, "");

  if (error) {
    showAlert(knownError(error, "Die Meldung konnte nicht gesendet werden. Bitte versuche es erneut."), "error");
    return;
  }

  elements.reportDialog.close();
  state.reportPostId = null;
  showAlert("Danke. Deine Meldung wurde vertraulich gespeichert.");
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && dialog.open) dialog.close();
}

elements.content.addEventListener("input", () => updateCounter(elements.content, elements.contentCount, 1000));
elements.editContent.addEventListener("input", () => updateCounter(elements.editContent, elements.editCount, 1000));
elements.reportDetails.addEventListener("input", () => updateCounter(elements.reportDetails, elements.reportCount, 240));
elements.composeForm.addEventListener("submit", createPost);
elements.editForm.addEventListener("submit", updatePost);
elements.reportForm.addEventListener("submit", reportPost);
elements.refresh.addEventListener("click", loadPosts);
elements.retry.addEventListener("click", loadPosts);

elements.postList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, postId } = button.dataset;
  if (action === "edit") openEditDialog(postId);
  if (action === "delete") deletePost(postId);
  if (action === "report") openReportDialog(postId);
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => closeDialog(button.dataset.closeDialog));
});

[elements.editDialog, elements.reportDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

communityClient.auth.onAuthStateChange((_event, session) => {
  setAuthState(session);
});

async function init() {
  updateCounter(elements.content, elements.contentCount, 1000);
  updateCounter(elements.editContent, elements.editCount, 1000);
  updateCounter(elements.reportDetails, elements.reportCount, 240);

  const authGenerationAtStart = state.authGeneration;
  const { data, error } = await communityClient.auth.getSession();

  if (error) {
    console.error("Anmeldestatus konnte nicht geprüft werden.", error);
    setAuthState(null);
    showAlert("Die Anmeldung konnte nicht geprüft werden. Lesen ist weiterhin möglich.", "error");
    return;
  }
  if (authGenerationAtStart === state.authGeneration) setAuthState(data.session);
  if (state.loadRequestId === 0) loadPosts();
}

init();
