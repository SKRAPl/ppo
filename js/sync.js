/*
 * PPO Sync — подключается к оригинальной вёрстке сайта и подставляет в неё
 * актуальные данные из репозитория (data/manifest.json + data/categories/*.json).
 * Визуально ничего не перестраивает: у каждого блока категории уже есть
 * id="data-block-<slug>", здесь только обновляется список .data__item внутри
 * его собственного .data__content — включая пустые "прокладки" между
 * группами карточек, они специально сохраняются, чтобы сетка не съезжала.
 *
 * Этот скрипт подключён и выполняется ДО scripts/script.js, поэтому поиск,
 * копирование и раскрытие категорий из оригинального скрипта продолжают
 * работать как раньше — они просто видят уже готовые данные.
 */
(function () {
  "use strict";

  function ownDataContent(block) {
    var content = block.querySelector(":scope > div.content");
    if (!content) return null;
    var wrapper = content.querySelector(":scope > div.wrapper");
    if (!wrapper) return null;
    return wrapper.querySelector(":scope > div.data__content");
  }

  function rebuildCategory(slug) {
    var block = document.getElementById("data-block-" + slug);
    if (!block) return;
    var dataContent = ownDataContent(block);
    if (!dataContent) return;

    Array.prototype.slice.call(dataContent.children).forEach(function (child) {
      if (child.matches && child.matches("div.data__item")) {
        dataContent.removeChild(child);
      }
    });

    // ВАЖНО: берём "сырые" данные (с пустыми "прокладками"), не getItems().
    var rawItems = window.PPOStore.getRawItems(slug);
    var frag = document.createDocumentFragment();
    rawItems.forEach(function (text) {
      var div = document.createElement("div");
      div.className = "data__item";
      var span = document.createElement("span");
      span.className = "data__item-text";
      if (text) span.textContent = text;
      div.appendChild(span);
      frag.appendChild(div);
    });
    dataContent.insertBefore(frag, dataContent.firstChild);
  }

  function rebuildAll() {
    window.PPOStore.getAllCategoriesIncludingHidden().forEach(function (cat) {
      rebuildCategory(cat.slug);
    });
  }

  function updateFooterAuthPill() {
    var label = document.getElementById("ppoAuthPillLabel");
    if (!label || !window.PPOAuth) return;
    var user = window.PPOAuth.currentUser();
    label.textContent = user ? user.username + " · Админка" : "Войти";
  }

  // Оригинальный scripts/script.js навешивает клик-копирование на карточки
  // .data__item ОДИН раз, в момент DOMContentLoaded — по снимку узлов на тот
  // момент. Так как наши данные подгружаются асинхронно (fetch), к моменту,
  // когда они придут, мы заменяем узлы внутри категорий на новые — и старые
  // обработчики клика на них, соответственно, теряются вместе со старыми
  // узлами. Чтобы копирование по клику не переставало работать, вешаем то же
  // самое поведение через делегирование на document — оно само переживает
  // любую последующую перестройку DOM.
  function bindClickToCopyDelegated() {
    document.addEventListener("click", function (e) {
      var item = e.target.closest(".data__item");
      if (!item) return;
      var textEl = item.querySelector(".data__item-text") || item.querySelector(".data__item-text1");
      if (!textEl) return;
      navigator.clipboard.writeText(textEl.innerText).catch(function () {});
      document.querySelectorAll(".data__item--active").forEach(function (el) {
        el.classList.remove("data__item--active");
      });
      item.classList.add("data__item--active");
    });
  }

  // Оригинальный scripts/script.js по правому клику / двойному клику на
  // карточку открывает всплывающий редактор фразы (можно дописать текст,
  // добавить "Возможен торг"/"Возможен обмен"/"Писать СМС", для а/м —
  // варианты FT/DT/ET, и скопировать результат). Он тоже навешивается ОДИН
  // раз при загрузке на снимок узлов, поэтому после нашей асинхронной
  // перестройки DOM переставал открываться на новых карточках. Разметка и
  // CSS-классы редактора уже есть в styles/style.css (не трогали), здесь —
  // тот же самый редактор, но навешанный через делегирование, чтобы
  // переживал любую перестройку списка.
  function bindQuickEditorDelegated() {
    let editor = document.getElementById("data-item-editor");
    if (!editor) {
      editor = document.createElement("div");
      editor.id = "data-item-editor";
      editor.className = "data__item-editor";
      document.body.appendChild(editor);
    }
    let overlay = document.getElementById("data-item-editor-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "data-item-editor-overlay";
      overlay.className = "data__item-editor-overlay";
      document.body.appendChild(overlay);
    }
    if (!document.getElementById("phrase-row-styles")) {
      const style = document.createElement("style");
      style.id = "phrase-row-styles";
      style.textContent =
        ".data__item-editor-outer-wrapper{display:flex;flex-direction:column;gap:8px;}" +
        ".data__item-editor-phrase-row{display:flex;flex-direction:row;gap:8px;}";
      document.head.appendChild(style);
    }

    let currentEditingItem = null;

    function selectAMVariant(textarea, variant, container) {
      const isActive = container.querySelector(`[data-variant="${variant}"]`)?.classList.contains("active");
      let currentValue = textarea.value;
      const lastQuoteIndex = currentValue.lastIndexOf('"');
      if (lastQuoteIndex !== -1) {
        const afterQuote = currentValue.slice(lastQuoteIndex + 1);
        const cleanedAfterQuote = afterQuote.replace(/^\s*(FT|DT|ET)?\s*/, "");
        currentValue = isActive
          ? currentValue.slice(0, lastQuoteIndex + 1) + cleanedAfterQuote
          : currentValue.slice(0, lastQuoteIndex + 1) + " " + variant + cleanedAfterQuote;
      }
      textarea.value = currentValue;
      container.querySelectorAll(".data__item-editor-btn--am").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.variant === variant && !isActive);
      });
      textarea.focus();
    }

    function togglePhrase(textarea, phrase, btn) {
      let text = textarea.value;
      if (btn.classList.contains("active")) {
        text = text.replace(new RegExp("\\s*" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "").trimEnd();
        btn.classList.remove("active");
      } else {
        text = text.trimEnd();
        text = text.length > 0 ? text + " " + phrase : phrase;
        btn.classList.add("active");
      }
      textarea.value = text;
      textarea.focus();
    }

    function closeEditor() {
      editor.classList.remove("show");
      overlay.classList.remove("show");
      if (currentEditingItem) currentEditingItem.classList.remove("data__item--editing");
      currentEditingItem = null;
    }

    function copyEditorText(textarea, btn) {
      const text = textarea.value.trim();
      if (!text) return;
      const done = () => {
        const original = btn.textContent;
        btn.textContent = "Скопировано!";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = original; btn.classList.remove("copied"); }, 2000);
      };
      navigator.clipboard.writeText(text).then(done).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      });
    }

    function openEditor(item) {
      const textSpan = item.querySelector(".data__item-text") || item.querySelector(".data__item-text1");
      if (!textSpan) return;
      const originalText = textSpan.textContent;
      currentEditingItem = item;
      editor.innerHTML = "";

      const outer = document.createElement("div");
      outer.className = "data__item-editor-outer-wrapper";
      const contentWrapper = document.createElement("div");
      contentWrapper.className = "data__item-editor-content-wrapper";
      const leftSide = document.createElement("div");
      leftSide.className = "data__item-editor-left-side";

      const textarea = document.createElement("textarea");
      textarea.value = originalText;
      textarea.spellcheck = false;

      const buttonContainer = document.createElement("div");
      buttonContainer.className = "data__item-editor-buttons";
      const copyBtn = document.createElement("button");
      copyBtn.className = "data__item-editor-btn data__item-editor-btn--copy";
      copyBtn.textContent = "Скопировать в буфер обмена";
      copyBtn.onclick = (e) => { e.stopPropagation(); copyEditorText(textarea, copyBtn); };
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "data__item-editor-btn data__item-editor-btn--cancel";
      cancelBtn.textContent = "Закрыть";
      cancelBtn.onclick = (e) => { e.stopPropagation(); closeEditor(); };
      buttonContainer.appendChild(copyBtn);
      buttonContainer.appendChild(cancelBtn);

      leftSide.appendChild(textarea);
      leftSide.appendChild(buttonContainer);

      const phraseRow = document.createElement("div");
      phraseRow.className = "data__item-editor-phrase-row";
      [
        { label: "Возможен торг", text: "Возможен торг." },
        { label: "Возможен обмен", text: "Возможен обмен." },
        { label: "Писать СМС", text: "Писать СМС." },
      ].forEach(({ label, text }) => {
        const btn = document.createElement("button");
        btn.className = "data__item-editor-btn data__item-editor-btn--am";
        btn.textContent = label;
        btn.dataset.phrase = text;
        if (textarea.value.includes(text)) btn.classList.add("active");
        btn.onclick = (e) => { e.stopPropagation(); togglePhrase(textarea, text, btn); };
        phraseRow.appendChild(btn);
      });

      outer.appendChild(phraseRow);
      contentWrapper.appendChild(leftSide);

      const hasAM = originalText.toLowerCase().includes("а/м");
      const hasMoto = originalText.toLowerCase().includes("мотоцикл");
      if (hasAM || hasMoto) {
        const amContainer = document.createElement("div");
        amContainer.className = "data__item-editor-am-buttons-side";
        ["FT", "DT", "ET"].forEach((variant) => {
          const btn = document.createElement("button");
          btn.className = "data__item-editor-btn data__item-editor-btn--am";
          btn.textContent = variant;
          btn.dataset.variant = variant;
          btn.onclick = (e) => { e.stopPropagation(); selectAMVariant(textarea, variant, amContainer); };
          amContainer.appendChild(btn);
        });
        contentWrapper.appendChild(amContainer);
      }

      outer.appendChild(contentWrapper);
      editor.appendChild(outer);
      editor.classList.add("show");
      overlay.classList.add("show");
      setTimeout(() => textarea.focus(), 50);
      item.classList.add("data__item--editing");
    }

    document.addEventListener("contextmenu", (e) => {
      const item = e.target.closest(".data__item");
      if (!item) return;
      e.preventDefault();
      openEditor(item);
    });
    document.addEventListener("dblclick", (e) => {
      const item = e.target.closest(".data__item");
      if (!item) return;
      openEditor(item);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && currentEditingItem) closeEditor();
    });
    overlay.addEventListener("click", closeEditor);
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindClickToCopyDelegated();
    bindQuickEditorDelegated();
    Promise.all([window.PPOStore.init(), window.PPOAuth.init()])
      .then(function () {
        rebuildAll();
        updateFooterAuthPill();
      })
      .catch(function (e) {
        console.error("PPO: не удалось загрузить данные из репозитория:", e);
      });
  });
})();
