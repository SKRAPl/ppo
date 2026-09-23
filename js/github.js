/*
 * PPO GitHub — тонкая обёртка над GitHub Contents API. Админка использует
 * её, чтобы КАЖДОЕ изменение (фраза, категория, пользователь, права)
 * сохранялось не в localStorage, а прямо коммитом в репозиторий — тогда
 * GitHub Pages переразвернёт сайт и изменения увидят все посетители, а не
 * только тот браузер, где их сделали.
 *
 * Токен и параметры репозитория хранятся ТОЛЬКО в localStorage того
 * браузера, где их ввели — это личный доступ конкретного администратора,
 * он никогда никуда не отправляется, кроме прямых запросов к api.github.com.
 */
(function (global) {
  "use strict";

  const LS_CONFIG = "ppo_github_config";
  const API_BASE = "https://api.github.com";

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function base64ToUtf8(b64) {
    const binary = atob(String(b64).replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function getConfig() {
    try {
      const raw = localStorage.getItem(LS_CONFIG);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
  }

  function clearConfig() {
    localStorage.removeItem(LS_CONFIG);
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c && c.owner && c.repo && c.token);
  }

  function authHeaders(cfg) {
    return {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function testConnection(cfg) {
    cfg = cfg || getConfig();
    if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
      return { ok: false, error: "Заполните владельца, репозиторий и токен." };
    }
    try {
      const res = await fetch(`${API_BASE}/repos/${cfg.owner}/${cfg.repo}`, {
        headers: authHeaders(cfg),
      });
      if (res.status === 404) return { ok: false, error: "Репозиторий не найден (или токен не имеет к нему доступа)." };
      if (res.status === 401) return { ok: false, error: "Токен недействителен." };
      if (!res.ok) return { ok: false, error: `GitHub вернул ошибку ${res.status}.` };
      const json = await res.json();
      const perms = json.permissions || {};
      if (!perms.push) {
        return { ok: false, error: "У токена нет прав на запись в этот репозиторий (нужен Contents: Read and write)." };
      }
      return { ok: true, defaultBranch: json.default_branch };
    } catch (e) {
      return { ok: false, error: "Не удалось связаться с GitHub: " + e.message };
    }
  }

  // Возвращает { content, sha } или null, если файла ещё нет (404).
  async function getFile(path) {
    const cfg = getConfig();
    if (!cfg) throw new Error("GitHub не подключён.");
    const branchQuery = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : "";
    const res = await fetch(`${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${path}${branchQuery}`, {
      headers: authHeaders(cfg),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status} при чтении ${path}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    return { content: base64ToUtf8(json.content), sha: json.sha };
  }

  // Создаёт или обновляет файл. sha обязателен, если файл уже существует.
  async function putFile(path, contentString, message, sha) {
    const cfg = getConfig();
    if (!cfg) throw new Error("GitHub не подключён.");
    const body = {
      message: message || `PPO admin: обновление ${path}`,
      content: utf8ToBase64(contentString),
    };
    if (sha) body.sha = sha;
    if (cfg.branch) body.branch = cfg.branch;
    const res = await fetch(`${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(cfg)),
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      return { ok: false, error: "Файл изменился с момента загрузки (конфликт). Обновите страницу и повторите." };
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { ok: false, error: `Не удалось сохранить (${res.status}): ${errBody.message || "неизвестная ошибка"}` };
    }
    const json = await res.json();
    return { ok: true, sha: json.content && json.content.sha };
  }

  // Читает файл (если есть) и записывает новое содержимое одной операцией.
  async function readModifyWrite(path, mutateFn, message) {
    const existing = await getFile(path);
    const currentValue = existing ? JSON.parse(existing.content) : null;
    const nextValue = mutateFn(currentValue);
    const res = await putFile(path, JSON.stringify(nextValue, null, 2), message, existing ? existing.sha : undefined);
    if (!res.ok) return res;
    return { ok: true, value: nextValue };
  }

  global.PPOGithub = {
    getConfig,
    saveConfig,
    clearConfig,
    isConfigured,
    testConnection,
    getFile,
    putFile,
    readModifyWrite,
  };
})(window);
