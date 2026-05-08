import {
  DEFAULT_THEME,
  normalizeTheme
} from "../../shared/constants.js";

const ANSI = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  underline: "[4m",
  black: "[30m",
  gray: "[90m",
  white: "[37m",
  cyan: "[36m",
  blue: "[34m",
  magenta: "[35m",
  lightAccent: "[38;2;34;95;120m",
  darkAccent: "[38;2;119;209;208m",
  green: "[38;2;70;148;175m",
  yellow: "[38;2;255;130;0m",
  red: "[38;2;220;53;19m"
};

function applyCodes(text, codes) {
  if (!text || !codes.length) {
    return text;
  }

  return `${codes.join("")}${text}${ANSI.reset}`;
}

function getDarkCodes(tone) {
  switch (tone) {
    case "label":
      return [ANSI.cyan];
    case "primary":
      return [ANSI.magenta];
    case "reset":
      return [ANSI.blue];
    case "secondary":
      return [ANSI.yellow];
    case "weeklyReset":
      return [ANSI.magenta];
    case "ctx":
      return [ANSI.green];
    case "muted":
      return [ANSI.dim, ANSI.white];
    case "barEmpty":
      return [ANSI.dim];
    case "good":
      return [ANSI.green];
    case "warn":
      return [ANSI.yellow];
    case "danger":
      return [ANSI.red];
    case "neutral":
      return [ANSI.white];
    default:
      return [];
  }
}

function getMonoCodes(tone) {
  switch (tone) {
    case "muted":
      return [ANSI.dim];
    case "barEmpty":
      return [ANSI.dim];
    case "reset":
      return [ANSI.underline];
    case "label":
    case "primary":
    case "secondary":
    case "weeklyReset":
    case "ctx":
    case "good":
    case "warn":
    case "danger":
    case "neutral":
      return [ANSI.bold];
    default:
      return [];
  }
}

function getLightCodes(tone) {
  switch (tone) {
    case "label":
      return [ANSI.cyan];
    case "primary":
      return [ANSI.magenta];
    case "reset":
      return [ANSI.blue];
    case "secondary":
      return [ANSI.yellow];
    case "weeklyReset":
      return [ANSI.magenta];
    case "ctx":
      return [ANSI.green];
    case "muted":
      return [ANSI.dim, ANSI.white];
    case "barEmpty":
      return [ANSI.dim];
    case "good":
      return [ANSI.green];
    case "warn":
      return [ANSI.yellow];
    case "danger":
      return [ANSI.red];
    case "neutral":
      return [ANSI.black];
    default:
      return [];
  }
}

export function applyTheme(segments, options = {}) {
  const theme = normalizeTheme(options.theme || DEFAULT_THEME);

  return segments
    .map((segment) => {
      const codes =
        theme === "mono"
          ? getMonoCodes(segment.tone)
          : theme === "light"
            ? getLightCodes(segment.tone)
            : getDarkCodes(segment.tone);
      return applyCodes(segment.text, codes);
    })
    .join("");
}
