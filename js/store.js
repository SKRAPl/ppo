/*
 * PPO Store — источник правды это JSON-файлы в репозитории:
 *   data/manifest.json              — список категорий
 *   data/categories/<slug>.json     — { template, blocks }
 *
 * Формат категории:
 *   template === null  → категория "как есть": blocks — список отдельных
 *                         строк ({type:"line", text}), без автосборки
 *                         (Номера, Отказы, Полезное, Услуги).
 *   template !== null  → "именованные" категории (Рыба, Автомобили, Одежда
 *                         и т.д.): {type:"entry", value:"Название"} — 4
 *                         строки купить/продать + пустая "прокладка"
 *                         собираются из template на лету.
 *
 * ЧЕРНОВИК (draft): изменения внутри категории (добавить/изменить/удалить)
 * сначала копятся ЛОКАЛЬНО (в памяти + localStorage, на случай перезагрузки
 * страницы) и никуда не коммитятся, пока не нажата кнопка «Сохранить» —
 * тогда весь накопленный набор уходит в репозиторий ОДНИМ коммитом. Это
 * только буфер на время редактирования: как только черновик сохранён, он
 * становится обычным содержимым файла в репозитории и черновик исчезает.
 *
 * ЧТЕНИЕ (getAllCategories/getEntries/...) работает для любого посетителя.
 * СОХРАНЕНИЕ ЧЕРНОВИКА — только из админки, через js/github.js.
 */
(function (global) {
  "use strict";

  let categories = [];
  let categoryDataCache = {}; // slug -> {template, blocks} — последнее закоммиченное состояние
  let draftCache = {}; // slug -> {template, blocks} — несохранённый черновик (если есть)
  let initPromise = null;

  function dataPath(file) { return "data/" + file; }
  function categoryPath(slug) { return `data/categories/${slug}.json`; }
  function draftKey(slug) { return `ppo_draft_${slug}`; }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Не удалось загрузить ${path} (${res.status})`);
    return res.json();
  }

  function loadDraftFromStorage(slug) {
    try {
      const raw = localStorage.getItem(draftKey(slug));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function persistDraft(slug) {
    localStorage.setItem(draftKey(slug), JSON.stringify(draftCache[slug]));
  }
  function clearDraftStorage(slug) {
    localStorage.removeItem(draftKey(slug));
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      categories = await fetchJson(dataPath("manifest.json"));
      await Promise.all(
        categories.map(async (c) => {
          try {
            categoryDataCache[c.slug] = await fetchJson(categoryPath(c.slug));
          } catch (e) {
            console.error("Не удалось загрузить категорию", c.slug, e);
            categoryDataCache[c.slug] = { template: null, blocks: [] };
          }
          const stored = loadDraftFromStorage(c.slug);
          if (stored) draftCache[c.slug] = stored;
        })
      );
    })();
    return initPromise;
  }

  function getAllCategories() { return categories.filter((c) => !c.hidden); }
  function getAllCategoriesIncludingHidden() { return categories.slice(); }
  function getCategory(slug) { return categories.find((c) => c.slug === slug) || null; }

  // Данные категории "как сейчас видно в админке" — черновик, если он есть,
  // иначе последнее закоммиченное состояние.
  function working(slug) {
    return draftCache[slug] || categoryDataCache[slug] || { template: null, blocks: [] };
  }

  function hasTemplate(slug) {
    const d = working(slug);
    return !!(d && d.template);
  }

  function hasDraft(slug) {
    return !!draftCache[slug];
  }

  function draftChangeCount(slug) {
    if (!draftCache[slug]) return 0;
    const a = JSON.stringify(categoryDataCache[slug] || { blocks: [] });
    const b = JSON.stringify(draftCache[slug]);
    if (a === b) return 0;
    // грубая, но достаточная оценка "сколько всего поменялось" — по числу блоков
    const base = (categoryDataCache[slug] && categoryDataCache[slug].blocks) || [];
    return Math.max(draftCache[slug].blocks.length, base.length) - Math.min(draftCache[slug].blocks.length, base.length) || 1;
  }

  function anyDraftsPending() {
    return Object.keys(draftCache).length > 0;
  }

  function ensureDraft(slug) {
    if (!draftCache[slug]) {
      const base = categoryDataCache[slug] || { template: null, blocks: [] };
      draftCache[slug] = JSON.parse(JSON.stringify(base));
    }
    return draftCache[slug];
  }

  function discardDraft(slug) {
    delete draftCache[slug];
    clearDraftStorage(slug);
  }

  function expandEntryToLines(template, bareName) {
    const wrap = template.nameWrapper || { prefix: "", suffix: "" };
    const fullVar = bareName !== "" ? wrap.prefix + bareName + wrap.suffix : "";
    const lines = [];
    for (const p of ["0", "1", "2", "3"]) {
      lines.push(template[p].prefix + fullVar + template[p].suffix);
      if (p === "1") lines.push("");
    }
    return lines;
  }

  // Полный список строк "как на сайте" — ВКЛЮЧАЯ пустые "прокладки".
  // Используется только для отрисовки настоящего сайта (js/sync.js), которая
  // черновиков никогда не видит (их создаёт только админка).
  function getRawItems(slug) {
    const d = categoryDataCache[slug];
    if (!d) return [];
    const lines = [];
    for (const b of d.blocks) {
      if (b.type === "entry") lines.push(...expandEntryToLines(d.template, b.value));
      else lines.push(b.text);
    }
    return lines;
  }

  // Список для админки: один блок = одна строка списка. Пустые "прокладки"
  // тоже показываются (компактной строкой), чтобы при ручной сборке
  // купить/продать было видно, что где стоит.
  function getEntries(slug) {
    const d = working(slug);
    if (!d) return [];
    return d.blocks.map((b, idx) => {
      const id = String(idx);
      if (b.type === "entry") {
        return { id, kind: "entry", name: b.value, isGeneric: b.value === "" };
      }
      if (b.text === "") return { id, kind: "blank" };
      return { id, kind: "line", text: b.text };
    });
  }

  function previewEntryLines(slug, bareName) {
    const d = working(slug);
    if (!d || !d.template) return [];
    return expandEntryToLines(d.template, bareName);
  }

  // ---------- запись: категории (манифест — сохраняется сразу, не через черновик) ----------
  async function commitManifest(mutateFn, message) {
    const res = await global.PPOGithub.readModifyWrite(dataPath("manifest.json"), (current) => mutateFn(current || []), message);
    if (res.ok) categories = res.value;
    return res;
  }

  function slugify(text) {
    const map = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
      и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
      с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
      ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    };
    let out = "";
    for (const ch of String(text).toLowerCase()) {
      if (map[ch] !== undefined) out += map[ch];
      else if (/[a-z0-9]/.test(ch)) out += ch;
      else out += "-";
    }
    return out.replace(/-+/g, "-").replace(/^-|-$/g, "") || "category";
  }

  async function addCategory(title, parentSlug, color) {
    title = String(title || "").trim();
    if (!title) return { ok: false, error: "Введите название категории." };
    let newSlug;
    const res = await commitManifest((list) => {
      const existing = new Set(list.map((c) => c.slug));
      let base = slugify(title);
      let slug = base, n = 1;
      while (existing.has(slug)) { n += 1; slug = `${base}-${n}`; }
      newSlug = slug;
      return list.concat([{ slug, title, parent: parentSlug || null, color: color || null, hidden: false }]);
    }, `Админка: добавлена категория «${title}»`);
    if (!res.ok) return res;
    const emptyPayload = { template: null, blocks: [] };
    const putRes = await global.PPOGithub.putFile(categoryPath(newSlug), JSON.stringify(emptyPayload, null, 1), `Админка: создан файл категории «${title}»`);
    if (!putRes.ok) return putRes;
    categoryDataCache[newSlug] = emptyPayload;
    return { ok: true, slug: newSlug };
  }

  async function renameCategory(slug, newTitle) {
    newTitle = String(newTitle || "").trim();
    if (!newTitle) return { ok: false, error: "Название не может быть пустым." };
    return commitManifest((list) => list.map((c) => (c.slug === slug ? Object.assign({}, c, { title: newTitle }) : c)),
      `Админка: переименована категория «${slug}» → «${newTitle}»`);
  }

  async function removeCategory(slug) {
    return commitManifest((list) => list.map((c) => (c.slug === slug ? Object.assign({}, c, { hidden: true }) : c)),
      `Админка: скрыта категория «${slug}»`);
  }

  async function restoreCategory(slug) {
    return commitManifest((list) => list.map((c) => (c.slug === slug ? Object.assign({}, c, { hidden: false }) : c)),
      `Админка: восстановлена категория «${slug}»`);
  }

  // ---------- черновик: локальные операции над содержимым категории (без сети) ----------
  function stageAddEntry(slug, name) {
    name = String(name || "").trim();
    if (!hasTemplate(slug)) return { ok: false, error: "У этой категории нет шаблона «купить/продать» — добавьте строку вручную." };
    if (!name) return { ok: false, error: "Введите название." };
    const draft = ensureDraft(slug);
    draft.blocks = draft.blocks.concat([{ type: "entry", value: name }]);
    persistDraft(slug);
    return { ok: true };
  }

  function stageEditEntry(slug, id, newName) {
    newName = String(newName || "").trim();
    if (!newName) return { ok: false, error: "Название не может быть пустым." };
    const idx = parseInt(id, 10);
    const draft = ensureDraft(slug);
    const blocks = draft.blocks.slice();
    if (!blocks[idx] || blocks[idx].type !== "entry") return { ok: false, error: "Запись не найдена." };
    blocks[idx] = { type: "entry", value: newName };
    draft.blocks = blocks;
    persistDraft(slug);
    return { ok: true };
  }

  function stageAddRawLine(slug, text) {
    text = String(text || "").trim();
    if (!text) return { ok: false, error: "Текст не может быть пустым." };
    const draft = ensureDraft(slug);
    draft.blocks = draft.blocks.concat([{ type: "line", text }]);
    persistDraft(slug);
    return { ok: true };
  }

  function stageEditRawLine(slug, id, newText) {
    newText = String(newText || "").trim();
    if (!newText) return { ok: false, error: "Текст не может быть пустым." };
    const idx = parseInt(id, 10);
    const draft = ensureDraft(slug);
    const blocks = draft.blocks.slice();
    if (!blocks[idx] || blocks[idx].type !== "line") return { ok: false, error: "Строка не найдена." };
    blocks[idx] = { type: "line", text: newText };
    draft.blocks = blocks;
    persistDraft(slug);
    return { ok: true };
  }

  function stageAddBlank(slug) {
    const draft = ensureDraft(slug);
    draft.blocks = draft.blocks.concat([{ type: "line", text: "" }]);
    persistDraft(slug);
    return { ok: true };
  }

  // Мини-форма "пара купить/продать вручную" — собирает стандартные 4
  // строки + пустую прокладку как обычные "сырые" строки (не через
  // авто-шаблон), чтобы можно было вписать что угодно лишнее (склад, г/м...).
  function stageAddPair(slug, description, amount) {
    description = String(description || "").trim();
    amount = String(amount || "").trim();
    if (!description) return { ok: false, error: "Введите текст объявления." };
    if (!amount) return { ok: false, error: "Введите фиксированную сумму." };
    const draft = ensureDraft(slug);
    const texts = [
      `Куплю ${description}. Бюджет: Свободный.`,
      `Куплю ${description}. Бюджет: ${amount}.`,
      "",
      `Продам ${description}. Цена: Договорная.`,
      `Продам ${description}. Цена: ${amount}.`,
    ];
    draft.blocks = draft.blocks.concat(texts.map((text) => ({ type: "line", text })));
    persistDraft(slug);
    return { ok: true };
  }

  function stageDeleteBlock(slug, id) {
    const idx = parseInt(id, 10);
    const draft = ensureDraft(slug);
    const blocks = draft.blocks.slice();
    blocks.splice(idx, 1);
    draft.blocks = blocks;
    persistDraft(slug);
    return { ok: true };
  }

  // ---------- сохранение черновика: один коммит на всю накопленную пачку ----------
  async function saveDraft(slug) {
    if (!draftCache[slug]) return { ok: true, noChanges: true };
    const draftBlocks = draftCache[slug].blocks;
    const cat = getCategory(slug);
    const res = await global.PPOGithub.readModifyWrite(
      categoryPath(slug),
      (current) => ({ template: (current && current.template) || draftCache[slug].template, blocks: draftBlocks }),
      `Админка: сохранены изменения в «${cat ? cat.title : slug}»`
    );
    if (!res.ok) return res;
    categoryDataCache[slug] = res.value;
    discardDraft(slug);
    return { ok: true };
  }

  function exportAll() {
    return { manifest: categories, categories: categoryDataCache, drafts: draftCache, exportedAt: new Date().toISOString() };
  }

  global.PPOStore = {
    init,
    getAllCategories,
    getAllCategoriesIncludingHidden,
    getCategory,
    hasTemplate,
    hasDraft,
    draftChangeCount,
    anyDraftsPending,
    discardDraft,
    saveDraft,
    getRawItems,
    getEntries,
    previewEntryLines,
    addCategory,
    renameCategory,
    removeCategory,
    restoreCategory,
    stageAddEntry,
    stageEditEntry,
    stageAddRawLine,
    stageEditRawLine,
    stageAddBlank,
    stageAddPair,
    stageDeleteBlock,
    exportAll,
    slugify,
  };
})(window);
