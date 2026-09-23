/*
 * PPO Auth — пользователи и права теперь тоже хранятся в репозитории
 * (data/users.json), а не в localStorage конкретного браузера. Значит,
 * пользователь, созданный одним администратором, может войти с любого
 * устройства — данные общие для всех.
 *
 * ВАЖНО (прочитайте обязательно): это статический сайт на GitHub Pages,
 * поэтому data/users.json — обычный публичный файл, как и всё остальное на
 * сайте. Пароли в нём не хранятся в открытом виде (только SHA-256 хэш с
 * солью), но сам факт, что список пользователей и хэши физически лежат в
 * публичном репозитории, стоит учитывать: не используйте для этих учётных
 * записей пароль, которым пользуетесь где-то ещё. Изменение пользователей и
 * прав (запись) требует подключения к GitHub с токеном — обычные посетители
 * сайта это сделать не могут, только тот, кто открыл админку и ввёл токен.
 */
(function (global) {
  "use strict";

  const LS_SESSION = "ppo_session";
  const USERS_PATH = "data/users.json";

  function bufToHex(buf) {
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return bufToHex(digest);
  }

  function randomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return bufToHex(arr);
  }

  let usersCache = null;
  let initPromise = null;

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const res = await fetch(USERS_PATH, { cache: "no-store" });
        usersCache = res.ok ? await res.json() : [];
      } catch (e) {
        console.error("Не удалось загрузить users.json:", e);
        usersCache = [];
      }
    })();
    return initPromise;
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function setSession(username) {
    localStorage.setItem(LS_SESSION, JSON.stringify({ username, at: Date.now() }));
  }
  function clearSession() {
    localStorage.removeItem(LS_SESSION);
  }

  function findUser(username) {
    return (usersCache || []).find((u) => u.username.toLowerCase() === String(username).toLowerCase()) || null;
  }

  function publicUser(user) {
    return {
      username: user.username,
      permissions: user.permissions,
      isMaster: !!user.isMaster,
      createdAt: user.createdAt,
    };
  }

  async function login(username, password) {
    const user = findUser(username);
    if (!user) return { ok: false, error: "Пользователь не найден." };
    const hash = await sha256(user.salt + password);
    if (hash !== user.passHash) return { ok: false, error: "Неверный пароль." };
    setSession(user.username);
    return { ok: true, user: publicUser(user) };
  }

  function logout() {
    clearSession();
  }

  function currentUser() {
    const session = getSession();
    if (!session) return null;
    const user = findUser(session.username);
    if (!user) {
      clearSession();
      return null;
    }
    return publicUser(user);
  }

  function listUsers() {
    return (usersCache || []).map(publicUser);
  }

  function emptyPermissions() {
    return { isSuper: false, canManageUsers: false, canManageCategories: false, categories: {} };
  }

  async function commitUsers(mutateFn, message) {
    const res = await global.PPOGithub.readModifyWrite(USERS_PATH, (current) => mutateFn(current || []), message);
    if (res.ok) usersCache = res.value;
    return res;
  }

  async function createUser(username, password, permissions) {
    username = String(username || "").trim();
    if (!username) return { ok: false, error: "Введите логин." };
    if (!password || password.length < 4) return { ok: false, error: "Пароль должен быть не короче 4 символов." };
    if (findUser(username)) return { ok: false, error: "Такой пользователь уже существует." };
    const salt = randomSalt();
    const passHash = await sha256(salt + password);
    const record = {
      username, salt, passHash,
      permissions: permissions || emptyPermissions(),
      createdAt: Date.now(),
      isMaster: false,
    };
    return commitUsers((list) => list.concat([record]), `Админка: создан пользователь «${username}»`);
  }

  async function updateUserPermissions(username, permissions) {
    const user = findUser(username);
    if (!user) return { ok: false, error: "Пользователь не найден." };
    if (user.isMaster) return { ok: false, error: "Права главного администратора нельзя изменить." };
    return commitUsers(
      (list) => list.map((u) => (u.username === username ? Object.assign({}, u, { permissions }) : u)),
      `Админка: изменены права «${username}»`
    );
  }

  async function resetPassword(username, newPassword) {
    if (!newPassword || newPassword.length < 4) return { ok: false, error: "Пароль должен быть не короче 4 символов." };
    const user = findUser(username);
    if (!user) return { ok: false, error: "Пользователь не найден." };
    const salt = randomSalt();
    const passHash = await sha256(salt + newPassword);
    return commitUsers(
      (list) => list.map((u) => (u.username === username ? Object.assign({}, u, { salt, passHash }) : u)),
      `Админка: сброшен пароль «${username}»`
    );
  }

  async function deleteUser(username) {
    const user = findUser(username);
    if (!user) return { ok: false, error: "Пользователь не найден." };
    if (user.isMaster) return { ok: false, error: "Главного администратора удалить нельзя." };
    const session = getSession();
    if (session && session.username === username) {
      return { ok: false, error: "Нельзя удалить пользователя, под которым вы сейчас вошли." };
    }
    return commitUsers((list) => list.filter((u) => u.username !== username), `Админка: удалён пользователь «${username}»`);
  }

  function can(user, action, slug) {
    if (!user || !user.permissions) return false;
    const perm = user.permissions;
    if (perm.isSuper) return true;
    if (action === "manageUsers") return !!perm.canManageUsers;
    if (action === "manageCategories") return !!perm.canManageCategories;
    const cat = perm.categories && perm.categories[slug];
    return !!(cat && cat[action]);
  }

  function canAny(user, slug) {
    if (!user) return false;
    if (user.permissions.isSuper) return true;
    const cat = user.permissions.categories && user.permissions.categories[slug];
    return !!(cat && (cat.add || cat.edit || cat.delete));
  }

  global.PPOAuth = {
    init,
    login,
    logout,
    currentUser,
    listUsers,
    createUser,
    updateUserPermissions,
    resetPassword,
    deleteUser,
    emptyPermissions,
    can,
    canAny,
  };
})(window);
