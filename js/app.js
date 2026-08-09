import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const COOKIE_NAME = "bingo_owner";
const { createClient } = window.supabase;

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const view = document.getElementById("view");
const toastEl = document.getElementById("toast");

let toastTimer = null;

function toast(message, isError = false, duration = 2800) {
  toastEl.hidden = false;
  toastEl.textContent = message;
  toastEl.classList.toggle("error", isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, duration);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function templateShareUrl(templateId) {
  const base = `${location.origin}${location.pathname}${location.search}`;
  return `${base}#/cards/new/${templateId}`;
}

async function copyText(text, successMessage = "Copied", duration = 2800) {
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage, false, duration);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(successMessage, false, duration);
      return true;
    } catch {
      toast("Could not copy to clipboard", true);
      return false;
    } finally {
      ta.remove();
    }
  }
}

async function shareTemplate(templateId) {
  if (!templateId) {
    toast("This card has no template to share", true);
    return;
  }
  await copyText(templateShareUrl(templateId), "Share link copied");
}

function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeRecoveryCode() {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const pick = (n) => {
    const out = [];
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (const b of buf) out.push(alphabet[b % alphabet.length]);
    return out.join("");
  };
  return `bingo-${pick(4)}-${pick(4)}`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name, value, days = 400) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseEntries(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function route() {
  const hash = location.hash.slice(1) || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "templates" && parts[1] === "new") return { name: "template-new" };
  if (parts[0] === "templates") return { name: "templates" };
  if (parts[0] === "cards" && parts[1] === "new") return { name: "card-new", templateId: parts[2] || null };
  if (parts[0] === "cards" && parts[1]) return { name: "card", id: parts[1] };
  if (parts[0] === "recover") return { name: "recover" };
  return { name: "home" };
}

async function ensureOwner() {
  let token = getCookie(COOKIE_NAME);
  if (token) {
    const { data, error } = await db
      .from("owners")
      .select("id, cookie_token, recovery_code")
      .eq("cookie_token", token)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  token = randomToken();
  const recovery = makeRecoveryCode();
  const { data, error } = await db
    .from("owners")
    .insert({ cookie_token: token, recovery_code: recovery })
    .select("id, cookie_token, recovery_code")
    .single();
  if (error) throw error;
  setCookie(COOKIE_NAME, token);
  return data;
}

async function recoverOwner(code) {
  const normalized = code.trim().toLowerCase();
  const { data, error } = await db
    .from("owners")
    .select("id, cookie_token, recovery_code")
    .eq("recovery_code", normalized)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No owner found for that recovery code.");
  setCookie(COOKIE_NAME, data.cookie_token);
  return data;
}

function renderConfigError() {
  view.innerHTML = `
    <section class="hero">
      <h1>Almost ready</h1>
      <p class="lede">Add your Supabase anon key in <code>js/config.js</code>, then run <code>schema.sql</code> in the Supabase SQL editor.</p>
      <div class="error-banner">SUPABASE_ANON_KEY is still a placeholder.</div>
    </section>
  `;
}

function homeView(owner, cards, templates) {
  return `
    <section class="hero">
      <h1>Make a board. Share a template. Mark as you go.</h1>
      <p class="lede">Anonymous play via cookie. Keep your recovery code if you switch devices.</p>
      <div class="actions">
        <a class="action" href="#/templates/new" data-link>
          <strong>New template</strong>
          <span>Paste words, one per line.</span>
        </a>
        <a class="action" href="#/templates" data-link>
          <strong>From a template</strong>
          <span>Copy a public template into your own shuffled card.</span>
        </a>
        <a class="action" href="#/recover" data-link>
          <strong>Recover access</strong>
          <span>Enter your code on another device.</span>
        </a>
      </div>
    </section>

    <section class="panel">
      <h2>Your templates</h2>
      ${
        templates.length
          ? `<ul class="list">${templates
              .map(
                (t) => `
            <li class="list-item">
              <span class="list-title">${escapeHtml(t.title || "Untitled template")}</span>
              <span class="meta">${t.rows}×${t.cols}</span>
              <div class="list-actions">
                <a class="btn btn-compact" href="#/cards/new/${t.id}" data-link>Create</a>
                <button type="button" class="btn secondary btn-compact" data-share-template="${t.id}">Share</button>
                <button type="button" class="btn danger btn-compact" data-delete-template="${t.id}">Delete</button>
              </div>
            </li>`
              )
              .join("")}</ul>`
          : `<p class="empty">No templates yet. Create one to share with others.</p>`
      }
    </section>

    <section class="panel">
      <h2>Your cards</h2>
      ${
        cards.length
          ? `<ul class="list">${cards
              .map(
                (c) => `
            <li class="list-item">
              <span class="list-title">${escapeHtml(c.title || "Untitled card")}</span>
              <span class="meta">${c.rows}×${c.cols}</span>
              <div class="list-actions">
                <a class="btn btn-compact" href="#/cards/${c.id}" data-link>Play</a>
                <button type="button" class="btn danger btn-compact" data-delete-card="${c.id}">Delete</button>
              </div>
            </li>`
              )
              .join("")}</ul>`
          : `<p class="empty">No cards yet. Create one from a template.</p>`
      }
    </section>

    <section class="recovery-box">
      <strong>Your recovery code</strong>
      <div>
        <button type="button" class="recovery-code" id="recovery-code" title="Click to copy">
          <code>${escapeHtml(owner.recovery_code)}</code>
        </button>
      </div>
      <p class="empty" style="margin-top:8px">Click to copy. Store this somewhere safe. Anyone with it can load your cards.</p>
    </section>
  `;
}

function templateNewView() {
  return `
    <section class="panel">
      <h1>New template</h1>
      <p class="lede">Enter entries separated by newlines. Need at least rows × cols words.</p>
      <form id="template-form" class="stack">
        <label>Title
          <input name="title" required maxlength="80" placeholder="Office bingo" />
        </label>
        <div class="row two">
          <label>Rows
            <select name="rows">
              ${[3, 4, 5, 6].map((n) => `<option value="${n}" ${n === 5 ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </label>
          <label>Cols
            <select name="cols">
              ${[3, 4, 5, 6].map((n) => `<option value="${n}" ${n === 5 ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </label>
        </div>
        <label>Entries
          <textarea name="entries" required placeholder="Coffee spill&#10;Late to standup&#10;Zoom fail"></textarea>
          <span class="entry-count" id="entry-count" aria-live="polite">0 entries</span>
        </label>
        <label style="font-weight:400">
          <span style="display:flex;gap:10px;align-items:center">
            <input type="checkbox" name="free" style="width:auto" checked />
            Pin a FREE space in the center when the grid is odd×odd
          </span>
        </label>
        <div class="btn-row">
          <button class="btn" type="submit">Create template</button>
          <a class="btn secondary" href="#/" data-link>Cancel</a>
        </div>
      </form>
    </section>
  `;
}

function templatesView(templates) {
  return `
    <section class="panel">
      <h1>Public templates</h1>
      <p class="lede">Pick one to create your own shuffled bingo card.</p>
      ${
        templates.length
          ? `<ul class="list">${templates
              .map(
                (t) => `
            <li class="list-item">
              <span class="list-title">${escapeHtml(t.title)}</span>
              <span class="meta">${t.rows}×${t.cols} · ${Array.isArray(t.entries) ? t.entries.length : 0} entries</span>
              <div class="list-actions">
                <a class="btn btn-compact" href="#/cards/new/${t.id}" data-link>Create</a>
                <button type="button" class="btn secondary btn-compact" data-share-template="${t.id}">Share</button>
              </div>
            </li>`
              )
              .join("")}</ul>`
          : `<p class="empty">No public templates yet.</p>`
      }
      <div class="btn-row">
        <a class="btn" href="#/templates/new" data-link>New template</a>
        <a class="btn secondary" href="#/" data-link>Home</a>
      </div>
    </section>
  `;
}

function existingCardChoiceView(template, existingCard) {
  return `
    <section class="panel">
      <h1>Card already exists</h1>
      <p class="lede">
        You already have a bingo card from
        <strong>${escapeHtml(template.title || "this template")}</strong>.
        Continue where you left off, or create a new shuffled card.
      </p>
      <div class="btn-row">
        <a class="btn" href="#/cards/${existingCard.id}" data-link>Continue existing</a>
        <button type="button" class="btn secondary" id="create-new-from-template" data-template-id="${template.id}">
          Create new
        </button>
        <a class="btn secondary" href="#/" data-link>Cancel</a>
      </div>
    </section>
  `;
}

function recoverView() {
  return `
    <section class="panel">
      <h1>Recover access</h1>
      <p class="lede">Paste the recovery code from your other device.</p>
      <form id="recover-form" class="stack">
        <label>Recovery code
          <input name="code" required placeholder="bingo-xxxx-xxxx" autocomplete="off" />
        </label>
        <div class="btn-row">
          <button class="btn" type="submit">Recover</button>
          <a class="btn secondary" href="#/" data-link>Cancel</a>
        </div>
      </form>
    </section>
  `;
}

function cardView(card) {
  const cells = Array.isArray(card.cells) ? card.cells : [];
  const marked = cells.filter((c) => c.marked).length;
  return `
    <section>
      <h1>${escapeHtml(card.title || "Bingo card")}</h1>
      <div class="bingo-meta">
        <span>${card.rows}×${card.cols}</span>
        <span id="marked-count">${marked} marked</span>
      </div>
      <div
        class="board"
        id="board"
        style="--cols: ${card.cols}; --rows: ${card.rows}; grid-template-columns: repeat(${card.cols}, minmax(0, 1fr))"
        data-card-id="${card.id}"
      >
        ${cells
          .map(
            (cell, i) => `
          <button
            type="button"
            class="cell ${cell.marked ? "marked" : ""}"
            data-index="${i}"
            aria-pressed="${cell.marked ? "true" : "false"}"
          ><span class="cell-text">${escapeHtml(cell.text)}</span></button>`
          )
          .join("")}
      </div>
      <div class="btn-row" style="margin-top:20px">
        ${
          card.template_id
            ? `<button type="button" class="btn" id="share-card-template" data-share-template="${card.template_id}">Share</button>`
            : ""
        }
        <a class="btn secondary" href="#/" data-link>All cards</a>
      </div>
    </section>
  `;
}

function buildCellsFromTemplate(template, useFree) {
  const need = template.rows * template.cols;
  let pool = [...template.entries];

  if (useFree && template.rows % 2 === 1 && template.cols % 2 === 1) {
    pool = pool.filter((e) => e.toLowerCase() !== "free");
    const center = Math.floor(need / 2);
    const picks = shuffle(pool).slice(0, need - 1);
    const cells = picks.map((text) => ({ text, marked: false }));
    cells.splice(center, 0, { text: "FREE", marked: true });
    return cells;
  }

  if (pool.length < need) {
    throw new Error(`Template needs at least ${need} entries.`);
  }
  return shuffle(pool)
    .slice(0, need)
    .map((text) => ({ text, marked: false }));
}

function bindShareButtons(root = view) {
  root.querySelectorAll("[data-share-template]").forEach((btn) => {
    btn.addEventListener("click", () => {
      shareTemplate(btn.dataset.shareTemplate);
    });
  });
}

async function deleteTemplate(templateId, ownerId) {
  const { error } = await db
    .from("bingo_templates")
    .delete()
    .eq("id", templateId)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

async function deleteCard(cardId, ownerId) {
  const { error } = await db
    .from("bingo_cards")
    .delete()
    .eq("id", cardId)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

function bindHome(owner) {
  const recoveryBtn = document.getElementById("recovery-code");
  if (recoveryBtn) {
    recoveryBtn.addEventListener("click", () => {
      copyText(owner.recovery_code, "Recovery code copied");
    });
  }

  bindShareButtons();

  view.querySelectorAll("[data-delete-template]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteTemplate;
      if (!id) return;
      if (!confirm("Delete this template? Existing cards made from it stay, but the template will be gone.")) {
        return;
      }
      btn.disabled = true;
      try {
        await deleteTemplate(id, owner.id);
        toast("Template deleted");
        await loadHome();
      } catch (err) {
        toast(err.message || "Could not delete template", true);
        btn.disabled = false;
      }
    });
  });

  view.querySelectorAll("[data-delete-card]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteCard;
      if (!id) return;
      if (!confirm("Delete this bingo card? This cannot be undone.")) {
        return;
      }
      btn.disabled = true;
      try {
        await deleteCard(id, owner.id);
        toast("Card deleted");
        await loadHome();
      } catch (err) {
        toast(err.message || "Could not delete card", true);
        btn.disabled = false;
      }
    });
  });
}

async function loadHome() {
  const owner = await ensureOwner();
  const [cardsRes, templatesRes] = await Promise.all([
    db
      .from("bingo_cards")
      .select("id, title, rows, cols, updated_at")
      .eq("owner_id", owner.id)
      .order("updated_at", { ascending: false }),
    db
      .from("bingo_templates")
      .select("id, title, rows, cols, created_at")
      .eq("owner_id", owner.id)
      .order("created_at", { ascending: false }),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (templatesRes.error) throw templatesRes.error;
  view.innerHTML = homeView(owner, cardsRes.data || [], templatesRes.data || []);
  bindHome(owner);
}

async function loadTemplates() {
  const { data, error } = await db
    .from("bingo_templates")
    .select("id, title, rows, cols, entries, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  view.innerHTML = templatesView(data || []);
  bindShareButtons();
}

async function loadCard(id) {
  const { data, error } = await db
    .from("bingo_cards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    view.innerHTML = `<section class="panel"><h1>Card not found</h1><a class="btn secondary" href="#/" data-link>Home</a></section>`;
    return;
  }
  view.innerHTML = cardView(data);
  bindShareButtons();
  bindBoard(data);
}

function fitCellText(cell) {
  const label = cell.querySelector(".cell-text");
  if (!label) return;
  label.style.fontSize = "";
  const maxPx = parseFloat(getComputedStyle(cell).fontSize) || 15.2;
  const minPx = 8;
  const availableH = Math.max(0, cell.clientHeight - 8);
  const availableW = Math.max(0, cell.clientWidth - 8);
  let size = maxPx;
  label.style.fontSize = `${size}px`;
  while (size > minPx && (label.scrollHeight > availableH || label.scrollWidth > availableW)) {
    size -= 0.5;
    label.style.fontSize = `${size}px`;
  }
}

function fitBoardCells(board) {
  if (!board) return;
  board.querySelectorAll(".cell").forEach(fitCellText);
}

function updateMarkedCount(cells) {
  const el = document.getElementById("marked-count");
  if (!el) return;
  const marked = cells.filter((c) => c.marked).length;
  el.textContent = `${marked} marked`;
}

let boardResizeAbort = null;

function bindBoard(card) {
  const board = document.getElementById("board");
  if (!board) return;
  let cells = Array.isArray(card.cells) ? structuredClone(card.cells) : [];
  let busy = new Set();

  requestAnimationFrame(() => fitBoardCells(board));
  if (boardResizeAbort) boardResizeAbort.abort();
  boardResizeAbort = new AbortController();
  window.addEventListener("resize", () => fitBoardCells(board), {
    passive: true,
    signal: boardResizeAbort.signal,
  });

  board.addEventListener("click", async (event) => {
    const btn = event.target.closest(".cell");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (Number.isNaN(index) || busy.has(index)) return;

    const nextMarked = !cells[index].marked;
    const previous = cells[index].marked;
    cells[index].marked = nextMarked;
    btn.classList.toggle("marked", nextMarked);
    btn.setAttribute("aria-pressed", nextMarked ? "true" : "false");
    updateMarkedCount(cells);
    btn.classList.add("pending");
    busy.add(index);

    const { error } = await db
      .from("bingo_cards")
      .update({ cells, updated_at: new Date().toISOString() })
      .eq("id", card.id);

    busy.delete(index);
    btn.classList.remove("pending");

    if (error) {
      cells[index].marked = previous;
      btn.classList.toggle("marked", previous);
      btn.setAttribute("aria-pressed", previous ? "true" : "false");
      updateMarkedCount(cells);
      toast(error.message || "Could not save mark", true);
      return;
    }
  });
}

function templateNeededEntries(form) {
  const rows = Number(form.rows.value);
  const cols = Number(form.cols.value);
  const need = rows * cols;
  const useFree = form.free.checked && rows % 2 === 1 && cols % 2 === 1;
  return useFree ? need - 1 : need;
}

function updateEntryCount(form) {
  const counter = document.getElementById("entry-count");
  if (!counter) return;
  const count = parseEntries(form.entries.value).length;
  const needed = templateNeededEntries(form);
  const label = count === 1 ? "entry" : "entries";
  counter.textContent = `${count} ${label} · ${needed} needed`;
  counter.classList.toggle("ready", count >= needed);
}

function bindTemplateForm(form) {
  const refresh = () => updateEntryCount(form);
  form.entries.addEventListener("input", refresh);
  form.rows.addEventListener("change", refresh);
  form.cols.addEventListener("change", refresh);
  form.free.addEventListener("change", refresh);
  refresh();
}

async function createTemplateFromForm(form) {
  const owner = await ensureOwner();
  const title = form.title.value.trim();
  const rows = Number(form.rows.value);
  const cols = Number(form.cols.value);
  const entries = parseEntries(form.entries.value);
  const oddGrid = rows % 2 === 1 && cols % 2 === 1;
  const hasFree = form.free.checked && oddGrid;
  const min = templateNeededEntries(form);

  if (entries.length < min) {
    throw new Error(`Enter at least ${min} entries for a ${rows}×${cols} board.`);
  }

  const { data, error } = await db
    .from("bingo_templates")
    .insert({
      owner_id: owner.id,
      title,
      rows,
      cols,
      entries,
      has_free: hasFree,
      is_public: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  await copyText(
    templateShareUrl(data.id),
    "Share link copied — template ready to share",
    4500
  );
  await createCardFromTemplate(data.id, { force: true, notify: false });
}

function bindExistingCardChoice(templateId) {
  const btn = document.getElementById("create-new-from-template");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      view.innerHTML = `<p class="empty">Creating your card…</p>`;
      await createCardFromTemplate(templateId, { force: true });
    } catch (err) {
      toast(err.message || "Failed to create card", true);
      try {
        await createCardFromTemplate(templateId, { force: false });
      } catch (retryErr) {
        view.innerHTML = `
          <section class="panel">
            <h1>Something went wrong</h1>
            <div class="error-banner">${escapeHtml(retryErr.message || String(retryErr))}</div>
            <a class="btn secondary" href="#/" data-link>Home</a>
          </section>
        `;
      }
    }
  });
}

async function findExistingCardForTemplate(ownerId, templateId) {
  const { data, error } = await db
    .from("bingo_cards")
    .select("id, title, updated_at")
    .eq("owner_id", ownerId)
    .eq("template_id", templateId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createCardFromTemplate(templateId, { force = false, notify = true } = {}) {
  const owner = await ensureOwner();
  const { data: template, error } = await db
    .from("bingo_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  if (!template) throw new Error("Template not found.");

  if (!force) {
    const existing = await findExistingCardForTemplate(owner.id, templateId);
    if (existing) {
      view.innerHTML = existingCardChoiceView(template, existing);
      bindExistingCardChoice(templateId);
      return;
    }
  }

  const useFree = template.has_free !== false;
  const cells = buildCellsFromTemplate(template, useFree);
  const { data: card, error: insertError } = await db
    .from("bingo_cards")
    .insert({
      owner_id: owner.id,
      template_id: template.id,
      title: template.title,
      rows: template.rows,
      cols: template.cols,
      cells,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  if (notify) toast("Card created");
  location.hash = `#/cards/${card.id}`;
}

async function render() {
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("PASTE_SUPABASE")) {
    renderConfigError();
    return;
  }

  const r = route();
  view.innerHTML = `<p class="empty">Loading…</p>`;

  try {
    if (r.name === "home") {
      await loadHome();
    } else if (r.name === "template-new") {
      view.innerHTML = templateNewView();
      const form = document.getElementById("template-form");
      bindTemplateForm(form);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await createTemplateFromForm(e.target);
        } catch (err) {
          toast(err.message || "Failed to create template", true);
          btn.disabled = false;
        }
      });
    } else if (r.name === "templates") {
      await loadTemplates();
    } else if (r.name === "card-new") {
      if (!r.templateId) {
        location.hash = "#/templates";
        return;
      }
      view.innerHTML = `<p class="empty">Creating your card…</p>`;
      await createCardFromTemplate(r.templateId);
    } else if (r.name === "card") {
      await loadCard(r.id);
    } else if (r.name === "recover") {
      view.innerHTML = recoverView();
      document.getElementById("recover-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await recoverOwner(e.target.code.value);
          toast("Recovered");
          location.hash = "#/";
        } catch (err) {
          toast(err.message || "Recovery failed", true);
          btn.disabled = false;
        }
      });
    } else {
      await loadHome();
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `
      <section class="panel">
        <h1>Something went wrong</h1>
        <div class="error-banner">${escapeHtml(err.message || String(err))}</div>
        <p class="lede">If this is a first run, execute <code>schema.sql</code> in Supabase and confirm the anon key in <code>js/config.js</code>.</p>
        <a class="btn secondary" href="#/" data-link>Home</a>
      </section>
    `;
  }
}

document.getElementById("btn-recover-nav").addEventListener("click", () => {
  location.hash = "#/recover";
});

window.addEventListener("hashchange", render);
render();
