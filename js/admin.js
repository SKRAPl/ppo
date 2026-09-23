(function () {
  "use strict";

  const el = {
    loadingScreen: document.getElementById("loadingScreen"),
    loginScreen: document.getElementById("loginScreen"),
    adminShell: document.getElementById("adminShell"),
    loginForm: document.getElementById("loginForm"),
    loginError: document.getElementById("loginError"),
    loginUsername: document.getElementById("loginUsername"),
    loginPassword: document.getElementById("loginPassword"),
    nav: document.getElementById("adminNav"),
    main: document.getElementById("adminMain"),
    whoami: document.getElementById("whoami"),
    logoutBtn: document.getElementById("logoutBtn"),
    githubStatus: document.getElementById("githubStatus"),
    modalRoot: document.getElementById("modalRoot"),
    toastStack: document.getElementById("toastStack"),
  };

  let currentView = { type: "welcome" };
  let searchTerms = {};
  let advancedOpen = {};

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function toast(message, kind) {
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = message;
    el.toastStack.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }

  function closeModal() { el.modalRoot.innerHTML = ""; }
  function openModal(html) {
    el.modalRoot.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal">${html}</div></div>`;
    document.getElementById("modalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "modalOverlay") closeModal();
    });
  }

  function user() { return PPOAuth.currentUser(); }

  async function withBusyButton(btn, fn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Сохраняю…";
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function renderGithubStatus() {
    const cfg = PPOGithub.getConfig();
    if (cfg && cfg.owner && cfg.repo) {
      el.githubStatus.innerHTML = `<span class="pill good">GitHub: ${escapeHtml(cfg.owner)}/${escapeHtml(cfg.repo)}</span>`;
    } else {
      el.githubStatus.innerHTML = `<span class="pill">GitHub не подключён</span>`;
    }
    el.githubStatus.style.cursor = "pointer";
  }
  el.githubStatus.addEventListener("click", openGithubSettingsModal);

  function openGithubSettingsModal() {
    const cfg = PPOGithub.getConfig() || { owner: "", repo: "", branch: "", token: "" };
    openModal(`
      <h3>Подключение к GitHub</h3>
      <p class="sub">Чтобы изменения из админки реально сохранялись в репозиторий (и были видны всем на GitHub
        Pages), нужен персональный токен доступа с правом записи в этот репозиторий.
        Токен хранится только в этом браузере и никуда, кроме api.github.com, не отправляется.</p>
      <div class="field"><label>Владелец (пользователь/организация)</label><input type="text" id="ghOwner" value="${escapeHtml(cfg.owner || "")}" placeholder="PolkaX"></div>
      <div class="field"><label>Репозиторий</label><input type="text" id="ghRepo" value="${escapeHtml(cfg.repo || "")}" placeholder="TABLE-PPO"></div>
      <div class="field"><label>Ветка (необязательно, по умолчанию — основная)</label><input type="text" id="ghBranch" value="${escapeHtml(cfg.branch || "")}" placeholder="main"></div>
      <div class="field"><label>Токен доступа (Personal Access Token)</label><input type="password" id="ghToken" value="${escapeHtml(cfg.token || "")}" placeholder="github_pat_…"></div>
      <div id="ghTestResult"></div>
      <p class="login-note">Создайте токен в GitHub → Settings → Developer settings → Fine-grained tokens,
        ограничив его ТОЛЬКО этим репозиторием и правом «Contents: Read and write». Не используйте токен с
        доступом ко всем репозиториям — это как выдать ключ от всего аккаунта.</p>
      <div class="modal__footer">
        <button id="ghDisconnect" class="danger">Отключить</button>
        <button id="ghTest">Проверить</button>
        <button class="primary" id="ghSave">Сохранить</button>
      </div>
    `);
    document.getElementById("ghDisconnect").addEventListener("click", () => {
      PPOGithub.clearConfig();
      closeModal();
      renderGithubStatus();
      toast("Отключено от GitHub", "success");
    });
    document.getElementById("ghTest").addEventListener("click", async (e) => {
      const btn = e.target;
      const testCfg = readGithubForm();
      const resultEl = document.getElementById("ghTestResult");
      await withBusyButton(btn, async () => {
        const res = await PPOGithub.testConnection(testCfg);
        resultEl.innerHTML = res.ok
          ? `<div class="confirm-bar" style="background:#132a1e;border-color:#245c39;color:#bdf5d0;">Подключение работает (ветка по умолчанию: ${escapeHtml(res.defaultBranch)})</div>`
          : `<div class="confirm-bar">${escapeHtml(res.error)}</div>`;
      });
    });
    document.getElementById("ghSave").addEventListener("click", () => {
      PPOGithub.saveConfig(readGithubForm());
      closeModal();
      renderGithubStatus();
      toast("Настройки GitHub сохранены", "success");
    });
  }

  function readGithubForm() {
    return {
      owner: document.getElementById("ghOwner").value.trim(),
      repo: document.getElementById("ghRepo").value.trim(),
      branch: document.getElementById("ghBranch").value.trim(),
      token: document.getElementById("ghToken").value.trim(),
    };
  }

  function requireGithub() {
    if (PPOGithub.isConfigured()) return true;
    toast("Сначала подключите GitHub (кнопка в верхней панели) — без этого сохранить изменения нельзя.", "error");
    openGithubSettingsModal();
    return false;
  }

  // ---------- boot ----------
  async function boot() {
    el.loadingScreen.style.display = "flex";
    el.loginScreen.style.display = "none";
    el.adminShell.style.display = "none";
    try {
      await Promise.all([PPOStore.init(), PPOAuth.init()]);
    } catch (e) {
      el.loadingScreen.innerHTML = `<div class="card" style="max-width:420px;">
        <h3>Не удалось загрузить данные</h3>
        <p class="sub">${escapeHtml(e.message)}</p>
        <p class="sub">Если вы открыли файл напрямую (file://) — данные не загрузятся из-за ограничений
          браузера. Запустите локальный сервер (например, <code>python3 -m http.server</code>) или откройте
          сайт через GitHub Pages.</p>
      </div>`;
      return;
    }
    el.loadingScreen.style.display = "none";
    renderGithubStatus();
    render();
  }

  function render() {
    const u = user();
    if (!u) {
      el.loginScreen.style.display = "flex";
      el.adminShell.style.display = "none";
      el.whoami.style.display = "none";
      el.logoutBtn.style.display = "none";
      return;
    }
    el.loginScreen.style.display = "none";
    el.adminShell.style.display = "flex";
    el.whoami.style.display = "inline-flex";
    el.logoutBtn.style.display = "inline-block";
    el.whoami.textContent = u.username + (u.isMaster ? " · главный администратор" : u.permissions.isSuper ? " · супер-админ" : "");
    if (!currentView.slugPicked) pickDefaultView(u);
    renderNav(u);
    renderMain(u);
  }

  function pickDefaultView(u) {
    const cats = PPOStore.getAllCategories();
    const accessible = cats.find((c) => u.permissions.isSuper || PPOAuth.canAny(u, c.slug));
    if (accessible) currentView = { type: "category", slug: accessible.slug };
    else if (PPOAuth.can(u, "manageUsers")) currentView = { type: "users" };
    else currentView = { type: "welcome" };
    currentView.slugPicked = true;
  }

  // ---------- nav ----------
  function renderNav(u) {
    const all = PPOStore.getAllCategories();
    const roots = all.filter((c) => !c.parent);
    const childrenOf = {};
    all.forEach((c) => { if (c.parent) (childrenOf[c.parent] = childrenOf[c.parent] || []).push(c); });
    function visible(cat) { return u.permissions.isSuper || PPOAuth.canAny(u, cat.slug); }

    let html = '<div class="admin-nav__section-title">Категории</div>';
    function entryCount(slug) { return PPOStore.getEntries(slug).filter((it) => it.kind !== "blank").length; }
    roots.forEach((cat) => {
      const children = (childrenOf[cat.slug] || []).filter(visible);
      if (!visible(cat) && children.length === 0) return;
      html += navItem(cat, entryCount(cat.slug), currentView.type === "category" && currentView.slug === cat.slug, false);
      children.forEach((ch) => {
        html += navItem(ch, entryCount(ch.slug), currentView.type === "category" && currentView.slug === ch.slug, true);
      });
    });

    if (u.permissions.isSuper || u.permissions.canManageCategories) {
      html += '<div class="admin-nav__section-title">Управление</div>';
      html += `<button class="admin-nav__item ${currentView.type === "categories-manage" ? "is-active" : ""}" data-view="categories-manage">Категории (добавить/скрыть)</button>`;
    }
    if (u.permissions.isSuper || u.permissions.canManageUsers) {
      html += (u.permissions.isSuper || u.permissions.canManageCategories) ? "" : '<div class="admin-nav__section-title">Управление</div>';
      html += `<button class="admin-nav__item ${currentView.type === "users" ? "is-active" : ""}" data-view="users">Пользователи и права</button>`;
    }
    el.nav.innerHTML = html;
  }

  function navItem(cat, count, active, child) {
    const dot = PPOStore.hasDraft(cat.slug) ? '<span class="admin-nav__dot" title="Есть несохранённые изменения"></span>' : "";
    return `<button class="admin-nav__item ${child ? "child" : ""} ${active ? "is-active" : ""}" data-view="category" data-slug="${cat.slug}">` +
      `<span>${dot}${escapeHtml(cat.title)}</span><span class="admin-nav__badge">${count}</span></button>`;
  }

  el.nav.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn) return;
    const view = btn.getAttribute("data-view");
    currentView = view === "category"
      ? { type: "category", slug: btn.getAttribute("data-slug"), slugPicked: true }
      : { type: view, slugPicked: true };
    render();
  });

  // ---------- main views ----------
  function renderMain(u) {
    if (currentView.type === "category") return renderCategoryView(u, currentView.slug);
    if (currentView.type === "users") return renderUsersView(u);
    if (currentView.type === "categories-manage") return renderCategoriesManageView(u);
    el.main.innerHTML = `<div class="no-permission">Выберите раздел слева, чтобы начать.</div>`;
  }

  function renderCategoryView(u, slug, focusField) {
    const cat = PPOStore.getCategory(slug);
    if (!cat) { el.main.innerHTML = `<div class="no-permission">Категория не найдена.</div>`; return; }
    if (!u.permissions.isSuper && !PPOAuth.canAny(u, slug)) {
      el.main.innerHTML = `<div class="no-permission">У вас нет прав на эту категорию.</div>`;
      return;
    }
    const canAdd = PPOAuth.can(u, "add", slug);
    const canEdit = PPOAuth.can(u, "edit", slug);
    const canDelete = PPOAuth.can(u, "delete", slug);
    const templated = PPOStore.hasTemplate(slug);
    const query = (searchTerms[slug] || "").toLowerCase();
    const allEntries = PPOStore.getEntries(slug);
    const entries = allEntries.filter((it) => {
      if (it.kind === "blank") return !query;
      const text = it.kind === "entry" ? it.name : it.text;
      return !query || text.toLowerCase().includes(query);
    });
    const shownCount = allEntries.filter((it) => it.kind !== "blank").length;
    const draftPending = PPOStore.hasDraft(slug);

    el.main.innerHTML =
      `<div class="admin-main__header">
        <div><h2>${escapeHtml(cat.title)}</h2><div class="sub">${shownCount} запис${shownCount === 1 ? "ь" : "ей"}${cat.parent ? " · подкатегория" : ""}${templated ? "" : " · без автосборки купить/продать"}</div></div>
        <div class="perm-summary">
          ${canAdd ? '<span class="pill good">можно добавлять</span>' : ""}
          ${canEdit ? '<span class="pill good">можно редактировать</span>' : ""}
          ${canDelete ? '<span class="pill good">можно удалять</span>' : ""}
        </div>
      </div>
      ${draftPending ? `<div class="draft-bar" id="draftBar">
        <span>Есть несохранённые изменения в этой категории.</span>
        <span class="spacer"></span>
        <button id="discardDraftBtn">Отменить всё</button>
        <button class="primary" id="saveDraftBtn">Сохранить изменения</button>
      </div>` : ""}
      <div class="toolbar">
        <input type="search" id="catSearch" placeholder="Найти в категории…" value="${escapeHtml(searchTerms[slug] || "")}">
      </div>
      ${canAdd ? renderAddSection(templated, slug) : ""}
      <div class="phrase-list" id="phraseList"></div>`;

    renderPhraseList(entries, { canEdit, canDelete }, slug);

    document.getElementById("catSearch").addEventListener("input", (e) => {
      searchTerms[slug] = e.target.value;
      const q = e.target.value.toLowerCase();
      const filtered = PPOStore.getEntries(slug).filter((it) => {
        if (it.kind === "blank") return !q;
        const text = it.kind === "entry" ? it.name : it.text;
        return !q || text.toLowerCase().includes(q);
      });
      renderPhraseList(filtered, { canEdit, canDelete }, slug);
    });

    if (canAdd) wireAddSection(u, slug, templated, focusField);

    if (draftPending) {
      document.getElementById("discardDraftBtn").addEventListener("click", () => {
        if (!confirm("Отменить все несохранённые изменения в этой категории?")) return;
        PPOStore.discardDraft(slug);
        toast("Изменения отменены", "success");
        renderNav(u);
        renderCategoryView(u, slug);
      });
      document.getElementById("saveDraftBtn").addEventListener("click", async (e) => {
        if (!requireGithub()) return;
        await withBusyButton(e.target, async () => {
          const res = await PPOStore.saveDraft(slug);
          if (!res.ok) return toast(res.error, "error");
          toast("Сохранено в репозиторий одним коммитом", "success");
          renderNav(u);
          renderCategoryView(u, slug);
        });
      });
    }
  }

  function renderAddSection(templated, slug) {
    const advancedOpenForCurrent = !!advancedOpen[slug];
    const advanced = `
      <button id="toggleAdvancedAdd" style="margin-top:10px; font-size:12.5px;">+ дополнительные варианты добавления</button>
      <div id="advancedAddPanel" style="display:${advancedOpenForCurrent ? "block" : "none"}; margin-top:12px;">
        <div class="add-row">
          <textarea id="newRawText" placeholder="Свободный текст строки, если она не укладывается в купить/продать" rows="2"></textarea>
          <button id="addRawBtn">Добавить строку</button>
        </div>
        <button id="addBlankBtn" style="margin-top:8px;">+ вставить пустую клетку</button>

        <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--line);">
          <div style="font-size:13px; font-weight:600; margin-bottom:4px;">Добавить пару купить/продать вручную</div>
          <p class="sub" style="margin:0 0 10px;">Соберёт стандартные 4 строки + пустую прокладку, но текст можно
            дополнить чем угодно — например размером склада или количеством гаражных мест.</p>
          <div class="field">
            <label>Текст (подставится после «Куплю» / «Продам»)</label>
            <input type="text" id="pairDesc" placeholder='квартиру в ЖК &quot;Якутия&quot;, Гвардейский р-н. Склад 5х36. 1 г/м.'>
          </div>
          <div class="field">
            <label>Фиксированная сумма (вместо «Свободный» / «Договорная»)</label>
            <input type="text" id="pairAmount" placeholder="1.000.000 рублей">
          </div>
          <div id="pairPreview" class="sub" style="margin:8px 0; white-space:pre-line; font-family:var(--font-mono); font-size:12px;"></div>
          <button id="addPairBtn">Добавить пару</button>
        </div>
      </div>`;

    if (templated) {
      return `<div class="card" style="margin-bottom:16px;">
        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div style="flex:1; min-width:220px;">
            <label style="display:block; font-size:12.5px; color:var(--text-1); margin-bottom:6px;">Название (одно на карточку — остальное соберётся само)</label>
            <input type="text" id="newEntryName" placeholder='Например: РР Фантом'>
          </div>
          <button class="primary" id="addEntryBtn">Добавить</button>
        </div>
        <div id="entryPreview" class="sub" style="margin-top:10px; white-space:pre-line; font-family:var(--font-mono); font-size:12px;"></div>
        ${advanced}
      </div>`;
    }
    return `<div class="card" style="margin-bottom:16px;">
      <div class="add-row">
        <textarea id="newRawText" placeholder="Текст новой строки" rows="2"></textarea>
        <button class="primary" id="addRawBtn">Добавить</button>
      </div>
      <button id="addBlankBtn" style="margin-top:8px;">+ вставить пустую клетку</button>
    </div>`;
  }

  function wireAddSection(u, slug, templated, focusField) {
    const rerender = (nextFocus) => {
      renderNav(u);
      renderCategoryView(u, slug, nextFocus);
    };

    if (templated) {
      const nameInput = document.getElementById("newEntryName");
      if (focusField === "name") { nameInput.focus(); }
      const preview = document.getElementById("entryPreview");
      nameInput.addEventListener("input", () => {
        const name = nameInput.value.trim();
        preview.textContent = name ? PPOStore.previewEntryLines(slug, name).filter((l) => l !== "").join("\n") : "";
      });
      const submitName = () => {
        const res = PPOStore.stageAddEntry(slug, nameInput.value);
        if (!res.ok) return toast(res.error, "error");
        toast("Добавлено в черновик — не забудьте сохранить", "success");
        rerender("name");
      };
      document.getElementById("addEntryBtn").addEventListener("click", submitName);
      nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitName(); });
      document.getElementById("toggleAdvancedAdd").addEventListener("click", () => {
        const panel = document.getElementById("advancedAddPanel");
        const nowOpen = panel.style.display === "none";
        panel.style.display = nowOpen ? "block" : "none";
        advancedOpen[slug] = nowOpen;
      });

      const pairDesc = document.getElementById("pairDesc");
      const pairAmount = document.getElementById("pairAmount");
      const pairPreview = document.getElementById("pairPreview");
      if (focusField === "pairDesc") pairDesc.focus();
      const updatePairPreview = () => {
        const d = pairDesc.value.trim(), a = pairAmount.value.trim();
        if (!d || !a) { pairPreview.textContent = ""; return; }
        pairPreview.textContent = [
          `Куплю ${d}. Бюджет: Свободный.`,
          `Куплю ${d}. Бюджет: ${a}.`,
          `Продам ${d}. Цена: Договорная.`,
          `Продам ${d}. Цена: ${a}.`,
        ].join("\n");
      };
      pairDesc.addEventListener("input", updatePairPreview);
      pairAmount.addEventListener("input", updatePairPreview);
      document.getElementById("addPairBtn").addEventListener("click", () => {
        const res = PPOStore.stageAddPair(slug, pairDesc.value, pairAmount.value);
        if (!res.ok) return toast(res.error, "error");
        toast("Пара добавлена в черновик — не забудьте сохранить", "success");
        rerender("pairDesc");
      });
    }

    document.getElementById("addBlankBtn").addEventListener("click", () => {
      PPOStore.stageAddBlank(slug);
      toast("Пустая клетка добавлена в черновик", "success");
      rerender();
    });

    const rawInput = document.getElementById("newRawText");
    if (focusField === "raw") rawInput.focus();
    document.getElementById("addRawBtn").addEventListener("click", () => {
      const res = PPOStore.stageAddRawLine(slug, rawInput.value);
      if (!res.ok) return toast(res.error, "error");
      toast("Строка добавлена в черновик — не забудьте сохранить", "success");
      rerender("raw");
    });
  }

  function renderPhraseList(entries, perms, slug) {
    const listEl = document.getElementById("phraseList");
    if (!listEl) return;
    if (entries.length === 0) {
      listEl.innerHTML = `<div class="no-permission">Ничего не найдено.</div>`;
      return;
    }
    listEl.innerHTML = entries
      .map((it) => {
        if (it.kind === "blank") {
          return `<div class="phrase phrase--blank" data-id="${escapeHtml(it.id)}" data-kind="blank">
            <div class="phrase__text"><em>— пустая клетка —</em></div>
            <div class="phrase__actions">
              ${perms.canDelete ? `<button data-action="delete" class="danger">Убрать</button>` : ""}
            </div>
          </div>`;
        }
        const label = it.kind === "entry"
          ? (it.isGeneric ? '<em>Универсальный вариант (без названия)</em>' : escapeHtml(it.name))
          : escapeHtml(it.text);
        const badge = it.kind === "entry" ? '<span class="phrase__badge">купить/продать</span>' : '<span class="phrase__badge" style="color:var(--text-2); border-color:var(--line);">строка</span>';
        return `<div class="phrase" data-id="${escapeHtml(it.id)}" data-kind="${it.kind}">
          <div class="phrase__text" data-view-text>${label}</div>
          ${badge}
          <div class="phrase__actions">
            ${perms.canEdit ? `<button data-action="edit">${it.kind === "entry" ? "Переименовать" : "Изменить"}</button>` : ""}
            ${perms.canDelete ? `<button data-action="delete" class="danger">Удалить</button>` : ""}
          </div>
        </div>`;
      })
      .join("");

    listEl.querySelectorAll(".phrase").forEach((row) => {
      const id = row.getAttribute("data-id");
      const kind = row.getAttribute("data-kind");
      const editBtn = row.querySelector('[data-action="edit"]');
      const delBtn = row.querySelector('[data-action="delete"]');
      if (editBtn) editBtn.addEventListener("click", () => enterEditMode(row, id, slug, kind));
      if (delBtn) delBtn.addEventListener("click", () => {
        const msg = kind === "entry" ? "Удалить эту карточку целиком (все её строки купить/продать)?" : kind === "blank" ? null : "Удалить эту строку?";
        if (msg && !confirm(msg)) return;
        PPOStore.stageDeleteBlock(slug, id);
        toast("Убрано из черновика — не забудьте сохранить", "success");
        renderNav(user());
        renderCategoryView(user(), slug);
      });
    });
  }

  function enterEditMode(row, id, slug, kind) {
    const textEl = row.querySelector("[data-view-text]");
    const original = kind === "entry" ? (textEl.textContent === "Универсальный вариант (без названия)" ? "" : textEl.textContent) : textEl.textContent;
    textEl.outerHTML = `<div class="phrase__text" data-edit-text><input type="text" value="${escapeHtml(original)}"></div>`;
    const actions = row.querySelector(".phrase__actions");
    actions.innerHTML = `<button data-action="save" class="primary">Ок</button><button data-action="cancel">Отмена</button>`;
    actions.querySelector('[data-action="save"]').addEventListener("click", () => {
      const value = row.querySelector("input").value;
      const res = kind === "entry" ? PPOStore.stageEditEntry(slug, id, value) : PPOStore.stageEditRawLine(slug, id, value);
      if (!res.ok) return toast(res.error, "error");
      toast("Изменено в черновике — не забудьте сохранить", "success");
      renderCategoryView(user(), slug);
    });
    actions.querySelector('[data-action="cancel"]').addEventListener("click", () => renderCategoryView(user(), slug));
  }

  // ---------- users & permissions ----------
  function permBadges(perm) {
    if (perm.isSuper) return '<span class="pill accent">супер-админ</span>';
    const out = [];
    if (perm.canManageUsers) out.push('<span class="pill good">пользователи</span>');
    if (perm.canManageCategories) out.push('<span class="pill good">категории</span>');
    const catCount = Object.keys(perm.categories || {}).filter((s) => {
      const c = perm.categories[s];
      return c && (c.add || c.edit || c.delete);
    }).length;
    if (catCount) out.push(`<span class="pill">${catCount} категор${catCount === 1 ? "ия" : "ий"}</span>`);
    return out.join(" ") || '<span class="pill">нет прав</span>';
  }

  function renderUsersView(u) {
    if (!u.permissions.isSuper && !u.permissions.canManageUsers) {
      el.main.innerHTML = `<div class="no-permission">У вас нет прав на управление пользователями.</div>`;
      return;
    }
    const users = PPOAuth.listUsers();
    el.main.innerHTML = `
      <div class="admin-main__header">
        <div><h2>Пользователи и права</h2><div class="sub">${users.length} пользовател${users.length === 1 ? "ь" : "ей"} · хранится в data/users.json репозитория</div></div>
        <button class="primary" id="createUserBtn">+ Новый пользователь</button>
      </div>
      <table class="users-table">
        <thead><tr><th>Логин</th><th>Права</th><th>Создан</th><th></th></tr></thead>
        <tbody id="usersTbody"></tbody>
      </table>`;

    const tbody = document.getElementById("usersTbody");
    tbody.innerHTML = users
      .map(
        (usr) => `<tr data-username="${escapeHtml(usr.username)}">
          <td>${escapeHtml(usr.username)}${usr.isMaster ? " 👑" : ""}</td>
          <td>${permBadges(usr.permissions)}</td>
          <td>${new Date(usr.createdAt).toLocaleDateString("ru-RU")}</td>
          <td style="text-align:right; white-space:nowrap;">
            ${usr.isMaster ? "" : `<button data-action="perms">Права</button>
            <button data-action="reset">Сбросить пароль</button>
            <button data-action="delete" class="danger">Удалить</button>`}
          </td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      const username = tr.getAttribute("data-username");
      const permsBtn = tr.querySelector('[data-action="perms"]');
      const resetBtn = tr.querySelector('[data-action="reset"]');
      const delBtn = tr.querySelector('[data-action="delete"]');
      if (permsBtn) permsBtn.addEventListener("click", () => openPermissionsModal(username));
      if (resetBtn) resetBtn.addEventListener("click", () => openResetPasswordModal(username));
      if (delBtn) delBtn.addEventListener("click", async () => {
        if (!requireGithub()) return;
        if (!confirm(`Удалить пользователя «${username}»?`)) return;
        await withBusyButton(delBtn, async () => {
          const res = await PPOAuth.deleteUser(username);
          if (!res.ok) return toast(res.error, "error");
          toast("Пользователь удалён", "success");
          renderUsersView(u);
        });
      });
    });

    document.getElementById("createUserBtn").addEventListener("click", () => openCreateUserModal(u));
  }

  function permMatrixHtml(existingPerms) {
    const cats = PPOStore.getAllCategories();
    const rows = cats
      .map((c) => {
        const p = (existingPerms.categories && existingPerms.categories[c.slug]) || {};
        return `<tr data-slug="${c.slug}">
          <td class="cat-name">${c.parent ? "&nbsp;&nbsp;↳ " : ""}${escapeHtml(c.title)}</td>
          <td class="checkbox-cell"><input type="checkbox" data-perm="add" ${p.add ? "checked" : ""}></td>
          <td class="checkbox-cell"><input type="checkbox" data-perm="edit" ${p.edit ? "checked" : ""}></td>
          <td class="checkbox-cell"><input type="checkbox" data-perm="delete" ${p.delete ? "checked" : ""}></td>
        </tr>`;
      })
      .join("");
    return `<table class="perm-matrix" id="permMatrixTable">
      <thead><tr><th>Категория</th><th>Добавлять</th><th>Редактировать</th><th>Удалять</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function readPermMatrix() {
    const out = {};
    document.querySelectorAll("#permMatrixTable tbody tr").forEach((tr) => {
      const slug = tr.getAttribute("data-slug");
      const add = tr.querySelector('[data-perm="add"]').checked;
      const editP = tr.querySelector('[data-perm="edit"]').checked;
      const del = tr.querySelector('[data-perm="delete"]').checked;
      if (add || editP || del) out[slug] = { add, edit: editP, delete: del };
    });
    return out;
  }

  function openCreateUserModal(actingUser) {
    const allowSuper = actingUser.permissions.isSuper;
    openModal(`
      <h3>Новый пользователь</h3>
      <p class="sub">Выдайте доступ только к тем категориям, которые понадобятся этому человеку. Учтите: реальная
        запись в репозиторий возможна, только если у этого человека также будет свой GitHub-токен с доступом
        к репозиторию — права здесь управляют только тем, что видно и доступно в самой админке.</p>
      <div class="field"><label>Логин</label><input type="text" id="newUsername" autocomplete="off"></div>
      <div class="field"><label>Пароль</label><input type="password" id="newPassword" autocomplete="new-password"></div>
      <div class="switch-row">
        <div><div class="label">Управление категориями</div><div class="desc">Может создавать/скрывать категории</div></div>
        <input type="checkbox" id="permManageCategories">
      </div>
      <div class="switch-row">
        <div><div class="label">Управление пользователями</div><div class="desc">Может создавать пользователей и менять права</div></div>
        <input type="checkbox" id="permManageUsers">
      </div>
      ${allowSuper ? `<div class="switch-row">
        <div><div class="label">Супер-администратор</div><div class="desc">Полный доступ ко всему, минуя матрицу ниже</div></div>
        <input type="checkbox" id="permSuper">
      </div>` : ""}
      <div class="field" style="margin-top:14px;"><label>Права по категориям</label>${permMatrixHtml({ categories: {} })}</div>
      <div class="modal__footer">
        <button id="cancelCreate">Отмена</button>
        <button class="primary" id="confirmCreate">Создать</button>
      </div>
    `);
    document.getElementById("cancelCreate").addEventListener("click", closeModal);
    document.getElementById("confirmCreate").addEventListener("click", async (e) => {
      if (!requireGithub()) return;
      const username = document.getElementById("newUsername").value;
      const password = document.getElementById("newPassword").value;
      const permissions = {
        isSuper: allowSuper && document.getElementById("permSuper") ? document.getElementById("permSuper").checked : false,
        canManageUsers: document.getElementById("permManageUsers").checked,
        canManageCategories: document.getElementById("permManageCategories").checked,
        categories: readPermMatrix(),
      };
      await withBusyButton(e.target, async () => {
        const res = await PPOAuth.createUser(username, password, permissions);
        if (!res.ok) return toast(res.error, "error");
        toast("Пользователь создан и сохранён в репозиторий", "success");
        closeModal();
        renderUsersView(user());
      });
    });
  }

  function openPermissionsModal(username) {
    const usr = PPOAuth.listUsers().find((x) => x.username === username);
    if (!usr) return;
    const actingSuper = user().permissions.isSuper;
    openModal(`
      <h3>Права пользователя «${escapeHtml(username)}»</h3>
      <div class="switch-row">
        <div><div class="label">Управление категориями</div></div>
        <input type="checkbox" id="permManageCategories" ${usr.permissions.canManageCategories ? "checked" : ""}>
      </div>
      <div class="switch-row">
        <div><div class="label">Управление пользователями</div></div>
        <input type="checkbox" id="permManageUsers" ${usr.permissions.canManageUsers ? "checked" : ""}>
      </div>
      ${actingSuper ? `<div class="switch-row">
        <div><div class="label">Супер-администратор</div></div>
        <input type="checkbox" id="permSuper" ${usr.permissions.isSuper ? "checked" : ""}>
      </div>` : ""}
      <div class="field" style="margin-top:14px;"><label>Права по категориям</label>${permMatrixHtml(usr.permissions)}</div>
      <div class="modal__footer">
        <button id="cancelPerms">Отмена</button>
        <button class="primary" id="savePerms">Сохранить</button>
      </div>
    `);
    document.getElementById("cancelPerms").addEventListener("click", closeModal);
    document.getElementById("savePerms").addEventListener("click", async (e) => {
      if (!requireGithub()) return;
      const permissions = {
        isSuper: actingSuper && document.getElementById("permSuper") ? document.getElementById("permSuper").checked : usr.permissions.isSuper,
        canManageUsers: document.getElementById("permManageUsers").checked,
        canManageCategories: document.getElementById("permManageCategories").checked,
        categories: readPermMatrix(),
      };
      await withBusyButton(e.target, async () => {
        const res = await PPOAuth.updateUserPermissions(username, permissions);
        if (!res.ok) return toast(res.error, "error");
        toast("Права обновлены", "success");
        closeModal();
        renderUsersView(user());
        renderNav(user());
      });
    });
  }

  function openResetPasswordModal(username) {
    openModal(`
      <h3>Сбросить пароль «${escapeHtml(username)}»</h3>
      <div class="field"><label>Новый пароль</label><input type="password" id="resetPass" autocomplete="new-password"></div>
      <div class="modal__footer">
        <button id="cancelReset">Отмена</button>
        <button class="primary" id="confirmReset">Сохранить</button>
      </div>
    `);
    document.getElementById("cancelReset").addEventListener("click", closeModal);
    document.getElementById("confirmReset").addEventListener("click", async (e) => {
      if (!requireGithub()) return;
      await withBusyButton(e.target, async () => {
        const res = await PPOAuth.resetPassword(username, document.getElementById("resetPass").value);
        if (!res.ok) return toast(res.error, "error");
        toast("Пароль обновлён", "success");
        closeModal();
      });
    });
  }

  // ---------- categories management ----------
  function renderCategoriesManageView(u) {
    if (!u.permissions.isSuper && !u.permissions.canManageCategories) {
      el.main.innerHTML = `<div class="no-permission">У вас нет прав на управление категориями.</div>`;
      return;
    }
    const cats = PPOStore.getAllCategories();
    const hidden = PPOStore.getAllCategoriesIncludingHidden().filter((c) => c.hidden);
    el.main.innerHTML = `
      <div class="admin-main__header">
        <div><h2>Категории</h2><div class="sub">${cats.length} видимых${hidden.length ? ", " + hidden.length + " скрыто" : ""}</div></div>
      </div>
      <div class="card" style="margin-bottom:18px;">
        <h3 style="font-size:15px;">Добавить категорию</h3>
        <div style="display:grid; grid-template-columns: 1fr 200px auto; gap:10px; margin-top:10px;">
          <input type="text" id="newCatTitle" placeholder="Название категории">
          <select id="newCatParent">
            <option value="">— без родителя —</option>
            ${cats.filter((c) => !c.parent).map((c) => `<option value="${c.slug}">${escapeHtml(c.title)}</option>`).join("")}
          </select>
          <button class="primary" id="addCatBtn">Добавить</button>
        </div>
      </div>
      <table class="users-table">
        <thead><tr><th>Название</th><th>Тип</th><th></th></tr></thead>
        <tbody id="catsTbody"></tbody>
      </table>
      ${hidden.length ? `<h3 style="font-size:15px; margin-top:26px;">Скрытые категории</h3>
      <table class="users-table"><tbody id="hiddenTbody">
        ${hidden.map((c) => `<tr data-slug="${c.slug}">
          <td>${escapeHtml(c.title)}</td>
          <td style="text-align:right;"><button data-action="restore">Показать снова</button></td>
        </tr>`).join("")}
      </tbody></table>` : ""}
      <div class="card" style="margin-top:26px;">
        <h3 style="font-size:15px;">Экспорт (только для просмотра)</h3>
        <p class="sub" style="margin:6px 0 12px;">Все данные и так хранятся в репозитории — эта кнопка просто
          выгружает текущий срез для локальной проверки/бэкапа.</p>
        <button id="exportBtn">Скачать копию (.json)</button>
      </div>`;

    document.getElementById("exportBtn").addEventListener("click", () => {
      const payload = PPOStore.exportAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ppo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    });

    const tbody = document.getElementById("catsTbody");
    tbody.innerHTML = cats
      .map(
        (c) => `<tr data-slug="${c.slug}">
          <td>${c.parent ? "&nbsp;&nbsp;↳ " : ""}<span data-title>${escapeHtml(c.title)}</span></td>
          <td>исходная/добавленная</td>
          <td style="text-align:right; white-space:nowrap;">
            <button data-action="rename">Переименовать</button>
            <button data-action="hide" class="danger">Скрыть</button>
          </td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      const slug = tr.getAttribute("data-slug");
      tr.querySelector('[data-action="rename"]').addEventListener("click", async () => {
        if (!requireGithub()) return;
        const cur = tr.querySelector("[data-title]").textContent;
        const next = prompt("Новое название категории:", cur);
        if (next === null || !next.trim()) return;
        const res = await PPOStore.renameCategory(slug, next.trim());
        if (!res.ok) return toast(res.error, "error");
        toast("Название обновлено", "success");
        renderCategoriesManageView(u);
        renderNav(u);
      });
      tr.querySelector('[data-action="hide"]').addEventListener("click", async () => {
        if (!requireGithub()) return;
        if (!confirm("Скрыть эту категорию со всего сайта и админки? Фразы внутри сохранятся, категорию можно будет восстановить.")) return;
        const res = await PPOStore.removeCategory(slug);
        if (!res.ok) return toast(res.error, "error");
        toast("Категория скрыта", "success");
        renderCategoriesManageView(u);
        renderNav(u);
      });
    });

    if (hidden.length) {
      document.getElementById("hiddenTbody").querySelectorAll("tr").forEach((tr) => {
        const slug = tr.getAttribute("data-slug");
        tr.querySelector('[data-action="restore"]').addEventListener("click", async () => {
          if (!requireGithub()) return;
          const res = await PPOStore.restoreCategory(slug);
          if (!res.ok) return toast(res.error, "error");
          toast("Категория возвращена", "success");
          renderCategoriesManageView(u);
          renderNav(u);
        });
      });
    }

    document.getElementById("addCatBtn").addEventListener("click", async (e) => {
      if (!requireGithub()) return;
      const title = document.getElementById("newCatTitle").value;
      const parent = document.getElementById("newCatParent").value || null;
      await withBusyButton(e.target, async () => {
        const res = await PPOStore.addCategory(title, parent, null);
        if (!res.ok) return toast(res.error, "error");
        toast("Категория добавлена", "success");
        renderCategoriesManageView(u);
        renderNav(u);
      });
    });
  }

  // ---------- login ----------
  el.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.loginError.style.display = "none";
    const res = await PPOAuth.login(el.loginUsername.value, el.loginPassword.value);
    if (!res.ok) {
      el.loginError.textContent = res.error;
      el.loginError.style.display = "block";
      return;
    }
    currentView = { type: "welcome" };
    render();
  });

  el.logoutBtn.addEventListener("click", () => {
    PPOAuth.logout();
    currentView = { type: "welcome" };
    render();
  });

  window.addEventListener("beforeunload", (e) => {
    if (PPOStore.anyDraftsPending()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  boot();
})();
