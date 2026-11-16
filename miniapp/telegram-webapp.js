(() => {
  const webApp = window.Telegram?.WebApp;
  const root = document.documentElement;

  if (!webApp) {
    root.dataset.telegramWebApp = "false";
    return;
  }

  root.dataset.telegramWebApp = "true";

  const toHsl = (value) => {
    if (typeof value !== "string") return null;
    const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
    if (!match) return null;

    const hex = match[1].length === 3
      ? [...match[1]].map((digit) => digit + digit).join("")
      : match[1];
    const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const min = Math.min(red, green, blue);
    const max = Math.max(red, green, blue);
    const delta = max - min;
    const lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;

    if (delta !== 0) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      switch (max) {
        case red:
          hue = ((green - blue) / delta) % 6;
          break;
        case green:
          hue = (blue - red) / delta + 2;
          break;
        default:
          hue = (red - green) / delta + 4;
      }
      hue = Math.round(hue * 60);
      if (hue < 0) hue += 360;
    }

    return `${hue}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%`;
  };

  const applyTheme = () => {
    const params = webApp.themeParams || {};
    const cssColors = {
      bg_color: ["--hsl-body"],
      text_color: ["--hsl-text"],
      button_color: ["--hsl-primary"],
      button_text_color: ["--hsl-on-primary"],
      secondary_bg_color: [
        "--hsl-surface-container",
        "--hsl-surface-container-low",
        "--hsl-surface-container-high",
        "--hsl-surface-container-highest",
      ],
      hint_color: ["--hsl-on-surface-variant"],
    };

    for (const [key, variables] of Object.entries(cssColors)) {
      const hsl = toHsl(params[key]);
      if (!hsl) continue;
      for (const variable of variables) {
        root.style.setProperty(variable, hsl);
      }
    }

    const background = params.bg_color;
    if (background && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(background)) {
      webApp.setHeaderColor?.(background);
      webApp.setBackgroundColor?.(background);
    }
    root.style.colorScheme = webApp.colorScheme === "dark" ? "dark" : "light";
  };

  const updateViewport = () => {
    if (Number.isFinite(webApp.viewportHeight)) {
      root.style.setProperty("--tg-viewport-height", `${webApp.viewportHeight}px`);
    }
    if (Number.isFinite(webApp.viewportStableHeight)) {
      root.style.setProperty("--tg-viewport-stable-height", `${webApp.viewportStableHeight}px`);
    }
  };

  webApp.ready();
  webApp.expand?.();
  applyTheme();
  updateViewport();
  webApp.onEvent?.("themeChanged", applyTheme);
  webApp.onEvent?.("viewportChanged", updateViewport);
})();
