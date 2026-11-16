(() => {
  const loginPanel = document.querySelector("#login-panel");
  const adminPanel = document.querySelector("#admin-panel");
  const loginForm = document.querySelector("#login-form");
  const loginMessage = document.querySelector("#login-message");
  const configForm = document.querySelector("#config-form");
  const configMessage = document.querySelector("#config-message");
  const systemNotice = document.querySelector("#system-notice");
  const codesTable = document.querySelector("#codes-table");
  const bindingsTable = document.querySelector("#bindings-table");
  const codeList = document.querySelector("#code-list");
  const codesDialog = document.querySelector("#codes-dialog");
  const issuedCodes = document.querySelector("#issued-codes");
  let csrfToken = "";
  let oneTimeCodes = [];

  const showMessage = (node, message, isError = false) => {
    node.textContent = message;
    node.classList.toggle("is-error", isError);
  };

  const api = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set("Content-Type", "application/json");
    if (csrfToken && options.method && options.method !== "GET") {
      headers.set("X-CSRF-Token", csrfToken);
    }
    const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("服务器返回了无法识别的响应。", { cause: error });
    }
    if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）。`);
    return result;
  };

  const setAuthenticated = (authenticated) => {
    loginPanel.hidden = authenticated;
    adminPanel.hidden = !authenticated;
    if (!authenticated) csrfToken = "";
  };

  const loadConfig = async () => {
    const config = await api("/api/admin/config");
    document.querySelector("#public-group-url").value = config.publicGroupUrl || "";
    document.querySelector("#announcement-messages").value = (config.announcementMessages || []).join("\n");
  };

  const formatDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
  };

  const renderEmptyRow = (table, columnCount, message) => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columnCount;
    cell.className = "empty-row";
    cell.textContent = message;
    row.append(cell);
    table.replaceChildren(row);
  };

  const loadCodes = async () => {
    const { codes } = await api("/api/admin/codes");
    codesTable.replaceChildren();
    if (!codes.length) {
      renderEmptyRow(codesTable, 5, "暂无激活码。生成后仅首次显示完整内容。");
      return;
    }
    const labels = { active: "未使用", used: "已使用", expired: "已过期", revoked: "已撤销" };
    for (const code of codes) {
      const row = document.createElement("tr");
      const hint = document.createElement("td");
      hint.textContent = code.hint;
      const status = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = `state-pill${code.status === "used" ? " is-used" : ["expired", "revoked"].includes(code.status) ? ` is-${code.status}` : ""}`;
      pill.textContent = labels[code.status] || "未知";
      status.append(pill);
      const created = document.createElement("td");
      created.textContent = formatDate(code.createdAt);
      const expires = document.createElement("td");
      expires.textContent = formatDate(code.expiresAt);
      const actionCell = document.createElement("td");
      if (code.status === "active") {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "table-action is-danger";
        revoke.textContent = "撤销";
        revoke.addEventListener("click", () => revokeCode(code.id));
        actionCell.append(revoke);
      }
      row.append(hint, status, created, expires, actionCell);
      codesTable.append(row);
    }
  };

  const loadBindings = async () => {
    const { bindings } = await api("/api/admin/bindings");
    bindingsTable.replaceChildren();
    if (!bindings.length) {
      renderEmptyRow(bindingsTable, 3, "暂无已绑定的 Telegram 账号。");
      return;
    }
    for (const binding of bindings) {
      const row = document.createElement("tr");
      const id = document.createElement("td");
      id.textContent = binding.telegramUserId;
      const date = document.createElement("td");
      date.textContent = formatDate(binding.boundAt);
      const actionCell = document.createElement("td");
      const unbind = document.createElement("button");
      unbind.type = "button";
      unbind.className = "table-action is-danger";
      unbind.textContent = "解除绑定";
      unbind.addEventListener("click", () => unbindDevice(binding.telegramUserId));
      actionCell.append(unbind);
      row.append(id, date, actionCell);
      bindingsTable.append(row);
    }
  };

  const loadDashboard = async (telegramConfigured) => {
    await Promise.all([loadConfig(), loadCodes(), loadBindings()]);
    const telegramStatus = document.querySelector("#telegram-status");
    telegramStatus.textContent = telegramConfigured
      ? "Telegram 校验已配置"
      : "待配置 Telegram Bot Token";
    if (!telegramConfigured) {
      systemNotice.hidden = false;
      systemNotice.textContent = "激活码可生成和管理，但设备绑定需要服务器配置 MINIAPP_TELEGRAM_BOT_TOKEN 并通过 HTTPS 部署。未配置前，小程序不能验证 Telegram 身份或完成绑定。";
    } else {
      systemNotice.hidden = true;
      systemNotice.textContent = "";
    }
  };

  const revokeCode = async (id) => {
    if (!window.confirm("确定撤销这个尚未使用的激活码吗？")) return;
    try {
      await api(`/api/admin/codes/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadCodes();
    } catch (error) {
      window.alert(error.message);
    }
  };

  const unbindDevice = async (telegramUserId) => {
    if (!window.confirm(`确定解除 Telegram 用户 ${telegramUserId} 的设备绑定吗？`)) return;
    try {
      await api(`/api/admin/bindings/${encodeURIComponent(telegramUserId)}`, { method: "DELETE" });
      await loadBindings();
    } catch (error) {
      window.alert(error.message);
    }
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(loginMessage, "");
    const password = new FormData(loginForm).get("password");
    try {
      const result = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      csrfToken = result.csrfToken;
      setAuthenticated(true);
      await loadDashboard(result.telegramConfigured);
      loginForm.reset();
    } catch (error) {
      showMessage(loginMessage, error.message, true);
    }
  });

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(configMessage, "");
    const announcementMessages = document.querySelector("#announcement-messages").value
      .split(/\r?\n/)
      .map((message) => message.trim())
      .filter(Boolean);
    const body = {
      publicGroupUrl: document.querySelector("#public-group-url").value.trim(),
      announcementMessages,
    };
    try {
      const saved = await api("/api/admin/config", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      document.querySelector("#public-group-url").value = saved.publicGroupUrl;
      document.querySelector("#announcement-messages").value = saved.announcementMessages.join("\n");
      showMessage(configMessage, "配置已安全保存并立即应用。");
    } catch (error) {
      showMessage(configMessage, error.message, true);
    }
  });

  document.querySelector("#code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const quantity = Number(document.querySelector("#code-quantity").value);
    const expiresInDays = Number(document.querySelector("#code-expiry").value);
    try {
      const result = await api("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({ quantity, expiresInDays }),
      });
      oneTimeCodes = result.codes;
      issuedCodes.replaceChildren();
      for (const code of oneTimeCodes) {
        const item = document.createElement("code");
        item.textContent = code;
        issuedCodes.append(item);
      }
      if (typeof codesDialog.showModal === "function") codesDialog.showModal();
      await loadCodes();
    } catch (error) {
      window.alert(error.message);
    }
  });

  document.querySelector("#copy-codes").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(oneTimeCodes.join("\n"));
      document.querySelector("#copy-codes").textContent = "已复制";
    } catch {
      window.alert("无法访问剪贴板，请手动复制窗口中的激活码。");
    }
  });

  document.querySelector("#close-codes-dialog").addEventListener("click", () => {
    oneTimeCodes = [];
    issuedCodes.replaceChildren();
    document.querySelector("#copy-codes").textContent = "复制全部激活码";
    codesDialog.close();
  });
  codesDialog.addEventListener("close", () => {
    oneTimeCodes = [];
    issuedCodes.replaceChildren();
    document.querySelector("#copy-codes").textContent = "复制全部激活码";
  });

  document.querySelector("#refresh-bindings").addEventListener("click", async () => {
    try {
      await loadBindings();
    } catch (error) {
      window.alert(error.message);
    }
  });

  document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
      setAuthenticated(false);
    } catch (error) {
      window.alert(error.message);
    }
  });

  const bootstrap = async () => {
    try {
      const state = await api("/api/admin/session");
      csrfToken = state.csrfToken || "";
      setAuthenticated(state.authenticated);
      if (state.authenticated) await loadDashboard(state.telegramConfigured);
    } catch (error) {
      setAuthenticated(false);
      showMessage(loginMessage, `无法连接后台服务：${error.message}`, true);
    }
  };

  bootstrap();
})();
