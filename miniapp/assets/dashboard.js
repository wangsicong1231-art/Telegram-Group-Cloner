(() => {
  const DEMO_ACTIVATION_CODE = "ZXCQ19902221";
  const SERVER_NOT_CONFIGURED_MESSAGE = "未配置服务器，请联系公群老板";
  const app = window.Telegram?.WebApp;
  const nameNode = document.querySelector("#user-name");
  const statusNode = document.querySelector("#auth-status");
  const indicator = document.querySelector("#auth-indicator");
  const avatar = document.querySelector("#user-avatar");
  const refreshButton = document.querySelector(".refresh-button");
  const dialog = document.querySelector("#info-dialog");
  const activationDialog = document.querySelector("#activation-dialog");
  const activationForm = document.querySelector("#activation-form");
  const activationCode = document.querySelector("#activation-code");
  const activationMessage = document.querySelector("#activation-message");
  const payoutDialog = document.querySelector("#payout-dialog");
  const payoutForm = document.querySelector("#payout-method-form");
  const payoutType = document.querySelector("#payout-type");
  const payoutAccountFields = document.querySelector("#payout-account-fields");
  const payoutUsdtFields = document.querySelector("#payout-usdt-fields");
  const payoutAccount = document.querySelector("#payout-account");
  const payoutAddress = document.querySelector("#payout-address");
  const payoutQrInput = document.querySelector("#payout-qr");
  const payoutFileName = document.querySelector("#payout-file-name");
  const payoutPreview = document.querySelector("#payout-preview");
  const payoutPreviewImage = document.querySelector("#payout-preview-image");
  const payoutHint = document.querySelector("#payout-dialog-hint");
  const dialogTitle = document.querySelector("#dialog-title");
  const dialogMessage = document.querySelector("#dialog-message");
  const toast = document.querySelector("#toast");
  const groupEntry = document.querySelector("#group-entry");
  const groupEntryHint = document.querySelector("#group-entry-hint");
  let isDeviceBound = false;
  let telegramIdentityVerified = false;
  let backendAvailable = false;
  const earningsStatus = document.querySelector("#earnings-status");
  const earningsHint = document.querySelector("#earnings-hint");
  const collectionHint = document.querySelector("#collection-hint");
  const noticeEmptyTitle = document.querySelector("#notice-empty-title");
  const noticeEmptyHint = document.querySelector("#notice-empty-hint");
  let toastTimer;
  let payoutPreviewUrl = "";
  let publicGroupUrl = "";
  let invalidGroupUrl = false;
  let configuredAnnouncements = [];

  const configureGroupUrl = (configuredGroupUrl) => {
    publicGroupUrl = "";
    invalidGroupUrl = false;
    if (typeof configuredGroupUrl === "string" && configuredGroupUrl.trim()) {
      try {
        const url = new URL(configuredGroupUrl.trim());
        if (url.protocol === "https:" && ["t.me", "telegram.me"].includes(url.hostname.toLowerCase())) {
          publicGroupUrl = url.href;
        } else {
          invalidGroupUrl = true;
        }
      } catch {
        invalidGroupUrl = true;
      }
    }
  };

  const refreshGroupEntry = () => {
    groupEntry.setAttribute("aria-disabled", String(!isDeviceBound || !publicGroupUrl));
    groupEntry.classList.toggle("is-configured", isDeviceBound && Boolean(publicGroupUrl));
    if (!isDeviceBound) {
      groupEntryHint.textContent = "绑定设备后解锁公群入口";
    } else if (publicGroupUrl) {
      groupEntryHint.textContent = "打开 Telegram 公群，查看群内动态";
    } else if (invalidGroupUrl) {
      groupEntryHint.textContent = "后台公群链接格式无效";
    } else {
      groupEntryHint.textContent = "后台配置公群链接后即可进入";
    }
  };

  const renderAnnouncements = () => {
    const defaultAnnouncement = isDeviceBound
      ? "欢迎使用充电宝数据采集"
      : "绑定设备后可解锁全部功能，收益、采集通知、激活与公群入口将在绑定后开放";
    const announcementItems = configuredAnnouncements.length
      ? configuredAnnouncements
      : [defaultAnnouncement];
    let announcementText = announcementItems.join("　✦　");
    while (announcementText.length < 48) {
      announcementText += `　✦　${announcementItems.join("　✦　")}`;
    }
    document.querySelectorAll(".ticker-copy").forEach((copy) => {
      copy.textContent = announcementText;
    });
  };

  const updateDeviceBinding = (bound) => {
    isDeviceBound = bound;
    if (isDeviceBound) {
      earningsStatus.lastChild.textContent = "等待数据接入";
      earningsHint.textContent = "接入账户服务后显示";
      collectionHint.textContent = "累计提交的数据记录";
      noticeEmptyTitle.textContent = "采集通知服务尚未连接";
      noticeEmptyHint.textContent = "接入数据服务后，这里将显示最新采集动态";
    } else {
      earningsStatus.lastChild.textContent = "绑定设备后解锁";
      earningsHint.textContent = "绑定设备后查看收益";
      collectionHint.textContent = "绑定设备后查看采集记录";
      noticeEmptyTitle.textContent = "绑定设备后查看采集通知";
      noticeEmptyHint.textContent = "完成设备绑定后，采集动态面板将开放";
    }
    document.querySelectorAll("[data-action]").forEach((action) => {
      const exempt = ["device-bind", "close-dialog"].includes(action.dataset.action);
      action.classList.toggle("is-gated", !isDeviceBound && !exempt);
      if (isDeviceBound || exempt) action.removeAttribute("aria-disabled");
      else action.setAttribute("aria-disabled", "true");
    });
    refreshGroupEntry();
    renderAnnouncements();
  };

  configureGroupUrl(window.__MINI_APP_CONFIG__?.publicGroupUrl);
  configuredAnnouncements = Array.isArray(window.__MINI_APP_CONFIG__?.announcementMessages)
    ? window.__MINI_APP_CONFIG__.announcementMessages
        .filter((message) => typeof message === "string" && message.trim())
        .slice(0, 8)
        .map((message) => message.trim().slice(0, 120))
    : [];
  updateDeviceBinding(false);

  const getTelegramUser = () => {
    const user = app?.initDataUnsafe?.user;
    if (!user || typeof user !== "object") return null;
    return user;
  };

  const renderTelegramContext = () => {
    const user = getTelegramUser();
    const hasSignedPayload = typeof app?.initData === "string" && app.initData.length > 0;
    if (!user) {
      nameNode.textContent = "Telegram 用户";
      avatar.textContent = "TG";
      statusNode.textContent = "请在 Telegram 中打开";
      indicator.classList.remove("is-connected");
      return;
    }

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    const displayName = fullName || (user.username ? `@${user.username}` : "Telegram 用户");
    nameNode.textContent = displayName;
    avatar.textContent = (user.first_name || user.username || "TG").slice(0, 1).toUpperCase();
    statusNode.textContent = telegramIdentityVerified
      ? "Telegram 会话已通过服务端验证"
      : hasSignedPayload
        ? "会话信息已读取 · 等待服务端校验"
        : "会话信息不可用";
    indicator.classList.toggle("is-connected", hasSignedPayload);
  };

  const showDialog = (title, message) => {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    if (typeof dialog.showModal === "function") dialog.showModal();
  };

  const openBindingDialog = () => {
    if (isDeviceBound) {
      showDialog("设备已绑定", "当前 Telegram 账号已绑定设备。");
      return;
    }
    if (typeof activationDialog.showModal !== "function") {
      showDialog("暂不支持设备绑定", "请使用支持弹窗的 Telegram 客户端打开小程序。");
      return;
    }
    activationForm.reset();
    activationMessage.textContent = backendAvailable
      ? ""
      : "绑定入口已打开；后台服务尚未连接，暂时无法验证激活码。";
    activationDialog.showModal();
  };

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };

  const readBackendResponse = async (response) => {
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("后台返回了无法识别的响应。", { cause: error });
    }
    if (!response.ok) throw new Error(result.error || `后台请求失败（${response.status}）。`);
    return result;
  };

  const loadBackendState = async () => {
    try {
      const configResponse = await fetch("/api/miniapp/config");
      if (configResponse.status === 404) return;
      const config = await readBackendResponse(configResponse);
      backendAvailable = true;
      configureGroupUrl(config.publicGroupUrl);
      configuredAnnouncements = Array.isArray(config.announcementMessages)
        ? config.announcementMessages
            .filter((message) => typeof message === "string" && message.trim())
            .slice(0, 8)
            .map((message) => message.trim().slice(0, 120))
        : [];
      refreshGroupEntry();
      renderAnnouncements();

      if (typeof app?.initData === "string" && app.initData) {
        const stateResponse = await fetch("/api/miniapp/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: app.initData }),
        });
        const state = await readBackendResponse(stateResponse);
        telegramIdentityVerified = true;
        renderTelegramContext();
        updateDeviceBinding(state.deviceBound === true);
      }
    } catch (error) {
      backendAvailable = false;
      telegramIdentityVerified = false;
      renderTelegramContext();
      updateDeviceBinding(false);
      console.error("Mini App backend request failed:", error);
      showToast("后台服务暂不可用，功能保持锁定");
    }
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    if (!isDeviceBound && !["bind", "device-bind", "close-dialog"].includes(button.dataset.action)) {
      event.preventDefault();
      showDialog("请先绑定设备", "请点击右上角“绑定”，输入激活码后继续。");
      return;
    }

    if (isDeviceBound && !backendAvailable && button.dataset.action !== "close-dialog") {
      event.preventDefault();
      showDialog("服务器未配置", SERVER_NOT_CONFIGURED_MESSAGE);
      return;
    }

    switch (button.dataset.action) {
      case "refresh":
        refreshButton.classList.add("is-refreshing");
        renderTelegramContext();
        loadBackendState();
        window.setTimeout(() => refreshButton.classList.remove("is-refreshing"), 450);
        showToast("正在刷新后台状态");
        break;
      case "bind":
      case "device-bind":
        openBindingDialog();
        break;
      case "devices":
        showDialog("设备数据待同步", "绑定设备数量和设备状态需要由服务端返回。当前页面不展示模拟设备或虚构统计。");
        break;
      case "activate":
        showDialog("设备激活服务尚未接入", "设备激活需要服务端验证并确认结果。请在激活接口接入后使用此功能。");
        break;
      case "notifications":
        showDialog("采集通知服务尚未接入", "采集实时通知需要服务端数据源或推送支持。接入前，此处不会显示虚构的动态。");
        break;
      case "payout-settings":
        if (typeof payoutDialog.showModal === "function") payoutDialog.showModal();
        else showDialog("收款方式服务尚未接入", "此浏览器暂不支持收款方式设置窗口。");
        break;
      case "group":
        if (!publicGroupUrl) {
          showDialog(
            invalidGroupUrl ? "公群链接配置无效" : "公群链接尚未配置",
            invalidGroupUrl
              ? "请将有效的 Telegram 公群 HTTPS 链接配置到后台的 publicGroupUrl。"
              : "请在后台设置 window.__MINI_APP_CONFIG__.publicGroupUrl 后，再从这里进入公群。",
          );
        } else if (typeof app?.openTelegramLink === "function") {
          app.openTelegramLink(publicGroupUrl);
        } else {
          window.open(publicGroupUrl, "_blank", "noopener,noreferrer");
        }
        break;
      case "close-dialog":
        dialog.close();
        break;
      default:
        break;
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  activationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    activationMessage.textContent = "";
    if (typeof app?.initData !== "string" || !app.initData) {
      activationMessage.textContent = "请在 Telegram 小程序内完成设备绑定。";
      return;
    }
    if (!backendAvailable) {
      if (activationCode.value.trim().toUpperCase() !== DEMO_ACTIVATION_CODE) {
        activationMessage.textContent = "激活码不正确，请检查后重试。";
        return;
      }
      activationDialog.close();
      updateDeviceBinding(true);
      showDialog(
        "演示激活完成",
        `${SERVER_NOT_CONFIGURED_MESSAGE} 当前激活状态仅用于页面演示，未完成服务端设备绑定。`,
      );
      return;
    }
    try {
      const response = await fetch("/api/miniapp/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: app.initData,
          activationCode: activationCode.value.trim(),
        }),
      });
      await readBackendResponse(response);
      activationDialog.close();
      updateDeviceBinding(true);
      showToast("设备绑定成功");
    } catch (error) {
      activationMessage.textContent = error.message;
    }
  });

  const setPayoutHint = (message, isError = false) => {
    payoutHint.textContent = message;
    payoutHint.classList.toggle("is-error", isError);
  };

  const updatePayoutFields = () => {
    const isUsdt = payoutType.value === "usdt";
    payoutAccountFields.hidden = isUsdt;
    payoutUsdtFields.hidden = !isUsdt;
    payoutAddress.required = isUsdt;
  };

  const clearPayoutPreview = () => {
    if (payoutPreviewUrl) URL.revokeObjectURL(payoutPreviewUrl);
    payoutPreviewUrl = "";
    payoutPreviewImage.removeAttribute("src");
    payoutPreview.hidden = true;
    payoutQrInput.value = "";
    payoutFileName.textContent = "选择收款码图片";
  };

  payoutType.addEventListener("change", updatePayoutFields);
  payoutQrInput.addEventListener("change", () => {
    const file = payoutQrInput.files?.[0];
    if (!file) {
      clearPayoutPreview();
      return;
    }

    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      clearPayoutPreview();
      setPayoutHint("请选择图片文件，且大小不超过 5 MB。", true);
      return;
    }

    if (payoutPreviewUrl) URL.revokeObjectURL(payoutPreviewUrl);
    payoutPreviewUrl = URL.createObjectURL(file);
    payoutPreviewImage.src = payoutPreviewUrl;
    payoutPreview.hidden = false;
    payoutFileName.textContent = file.name;
    setPayoutHint("图片仅在本地预览；当前尚无收款信息保存服务，不会上传或保存。");
  });

  payoutForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (payoutType.value === "usdt" && !payoutAddress.value.trim()) {
      setPayoutHint("请填写 USDT 钱包地址。", true);
      payoutAddress.focus();
      return;
    }
    if (payoutType.value !== "usdt" && !payoutAccount.value.trim() && !payoutQrInput.files?.length) {
      setPayoutHint("请填写收款账号或选择收款码图片。", true);
      payoutAccount.focus();
      return;
    }

    setPayoutHint("提交服务尚未接入，收款信息未上传或保存。", true);
  });

  payoutDialog.addEventListener("close", () => {
    clearPayoutPreview();
    payoutForm.reset();
    updatePayoutFields();
    setPayoutHint("当前尚无收款信息保存服务。填写内容和图片只用于本地预览，不会上传或保存。");
  });

  renderTelegramContext();
  loadBackendState();
})();
