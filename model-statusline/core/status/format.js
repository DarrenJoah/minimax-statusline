import {
  normalizeDisplayMode,
  normalizeStatusStyle,
  normalizeTheme
} from "../../shared/constants.js";
import { buildBar } from "./bar.js";
import { applyTheme } from "./theme.js";
import { buildStatusViewModel } from "./viewModel.js";

function createErrorSegments(model, displayName) {
  const tone = model.kind === "auth_error" ? "danger" : "warn";
  return [
    { text: displayName, tone: "label" },
    { text: " | ", tone: "muted" },
    {
      text: model.kind === "auth_error" ? "auth expired" : "quota unavailable",
      tone
    }
  ];
}

function createQuotaTextSegments(quota, displayMode, tone) {
  const mode = normalizeDisplayMode(displayMode);

  if (mode === "used") {
    return [
      { text: `${quota.label} used `, tone: "primary" },
      { text: quota.usedText, tone }
    ];
  }

  return [
    { text: `${quota.label} `, tone: "primary" },
    { text: quota.leftText, tone }
  ];
}

function getSecondaryText(quota, displayMode) {
  return normalizeDisplayMode(displayMode) === "used"
    ? quota.usedText
    : quota.leftText;
}

function formatWeeklyReset(timestampMs) {
  if (!Number.isFinite(timestampMs)) return null;
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${m}-${d} ${hh}:${mm}`;
}

function appendSecondarySegments(segments, model, displayMode) {
  if (!model.secondaryQuota) {
    return segments;
  }

  const result = [
    ...segments,
    { text: " | ", tone: "muted" },
    { text: `${model.secondaryQuota.label} `, tone: "secondary" },
    { text: getSecondaryText(model.secondaryQuota, displayMode), tone: "secondary" }
  ];

  const wReset = formatWeeklyReset(model.secondaryQuota.nextResetTime);
  if (wReset) {
    result.push(
      { text: " | W:reset ", tone: "weeklyReset" },
      { text: wReset, tone: "weeklyReset" }
    );
  }

  return result;
}

function appendResetSegments(segments, model) {
  if (!model.resetText) {
    return segments;
  }

  return [
    ...segments,
    { text: " | reset ", tone: "reset" },
    { text: model.resetText, tone: "reset" }
  ];
}

function createTextSegments(model, displayMode) {
  const severityTone = model.severity;

  return appendSecondarySegments(
    appendResetSegments(
      [
        { text: model.levelLabel, tone: "label" },
        { text: " | ", tone: "muted" },
        ...createQuotaTextSegments(model.primaryQuota, displayMode, severityTone)
      ],
      model
    ),
    model,
    displayMode
  );
}

function createCompactSegments(model, displayMode) {
  const severityTone = model.severity;
  let segments;

  if (model.secondaryQuota) {
    segments = [
      { text: `${model.compactLabel} `, tone: "label" },
      { text: `${model.primaryQuota.compactLabel} `, tone: "muted" },
      { text: model.primaryQuota.leftText, tone: severityTone },
      { text: " ", tone: "plain" },
      { text: `${model.secondaryQuota.compactLabel} `, tone: "muted" },
      { text: getSecondaryText(model.secondaryQuota, displayMode), tone: "plain" }
    ];
  } else {
    segments = [
      { text: `${model.compactLabel} `, tone: "label" },
      { text: model.primaryQuota.leftText, tone: severityTone }
    ];
  }

  if (model.resetText) {
    segments.push({ text: " | ", tone: "muted" }, { text: model.resetText, tone: "reset" });
  }

  return segments;
}

function createBarMetric(quota, displayMode) {
  if (normalizeDisplayMode(displayMode) === "used") {
    return {
      percent: quota.usedPercent,
      text: quota.usedText
    };
  }

  return {
    percent: quota.leftPercent,
    text: quota.leftText
  };
}

function createBalanceSegments(model, displayMode, style) {
  const balanceText = model.primaryQuota.balanceText;
  const tone = "good";

  if (style === "bar") {
    return [
      { text: model.levelLabel, tone: "label" },
      { text: " ", tone: "plain" },
      { text: balanceText, tone }
    ];
  }

  if (style === "compact") {
    return [
      { text: `${model.compactLabel} `, tone: "label" },
      { text: balanceText, tone }
    ];
  }

  // text
  return [
    { text: model.levelLabel, tone: "label" },
    { text: " | ", tone: "muted" },
    { text: `balance ${balanceText}`, tone }
  ];
}

function createBarSegments(model, displayMode) {
  if (
    !Number.isFinite(model.primaryQuota?.leftPercent) ||
    !Number.isFinite(model.primaryQuota?.usedPercent)
  ) {
    return createErrorSegments({ kind: "unavailable" });
  }

  const metric = createBarMetric(model.primaryQuota, displayMode);
  const bar = buildBar(metric.percent);
  const severityTone = model.severity;
  const segments = [
    { text: model.levelLabel, tone: "label" },
    { text: " ", tone: "plain" },
    { text: bar.filledText, tone: severityTone },
    { text: bar.emptyText, tone: "barEmpty" },
    { text: " ", tone: "plain" },
    { text: metric.text, tone: severityTone }
  ];

  if (model.resetText) {
    segments.push({ text: " | reset ", tone: "reset" }, { text: model.resetText, tone: "reset" });
  }

  if (model.secondaryQuota) {
    segments.push(
      { text: " | ", tone: "muted" },
      { text: `${model.secondaryQuota.compactLabel} `, tone: "secondary" },
      { text: getSecondaryText(model.secondaryQuota, displayMode), tone: "secondary" }
    );
  }

  if (model.secondaryQuota?.nextResetTime) {
    const wReset = formatWeeklyReset(model.secondaryQuota.nextResetTime);
    if (wReset) {
      segments.push(
        { text: " | W:reset ", tone: "weeklyReset" },
        { text: wReset, tone: "weeklyReset" }
      );
    }
  }

  return segments;
}

function getCtxSeverity(usedPercent) {
  if (!Number.isFinite(usedPercent)) {
    return "neutral";
  }

  if (usedPercent >= 80) {
    return "danger";
  }

  if (usedPercent >= 60) {
    return "warn";
  }

  return "good";
}

function buildCtxSegments(ctxModel, style) {
  const severity = getCtxSeverity(ctxModel.usedPercent);
  const percentText = `${ctxModel.usedPercent}%`;

  if (style === "bar") {
    const bar = buildBar(ctxModel.usedPercent, undefined, 6);
    return [
      { text: " | ctx ", tone: "ctx" },
      { text: bar.filledText, tone: severity },
      { text: bar.emptyText, tone: "barEmpty" },
      { text: " ", tone: "plain" },
      { text: percentText, tone: severity }
    ];
  }

  return [
    { text: " | ctx ", tone: "ctx" },
    { text: percentText, tone: severity }
  ];
}

export function formatStatus(result, options = {}) {
  const theme = normalizeTheme(options.theme);
  const displayName = options.displayName || "GLM";
  const model = buildStatusViewModel(result, {
    displayName,
    compactLabel: options.compactLabel || displayName
  });

  if (model.kind !== "success") {
    return applyTheme(createErrorSegments(model, displayName), { theme });
  }

  const style = normalizeStatusStyle(options.style);
  let segments;

  // Balance-based display (Kimi: monetary balance)
  if (model.isBalance) {
    segments = createBalanceSegments(model, options.displayMode, style);
    return applyTheme(segments, { theme });
  }

  if (style === "compact") {
    segments = createCompactSegments(model, options.displayMode);
  } else if (style === "bar") {
    segments = createBarSegments(model, options.displayMode);
  } else {
    segments = createTextSegments(model, options.displayMode);
  }

  if (options.ctxModel) {
    const ctxSegs = buildCtxSegments(options.ctxModel, style);
    // Insert ctx after model name (first segment)
    segments = [segments[0], ...ctxSegs, ...segments.slice(1)];
  }

  return applyTheme(segments, { theme });
}
