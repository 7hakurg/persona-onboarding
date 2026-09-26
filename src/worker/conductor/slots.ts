export type NameResult =
  | { ok: true; value: string; needsConfirmation: boolean }
  | { ok: false; reason: "empty" | "too_long" | "invalid_characters" };

export type GoalResult = { ok: true; value: string } | { ok: false; reason: "too_short" };

const USER_NAME_MAX = 40;
const AGENT_NAME_MAX = 30;
const GOAL_MIN = 2;
const GOAL_MAX = 500;

const USER_LEAD_INS = /^(?:hi|hey|hello|so|well|ok|okay|yeah|yes)?[,!.\s]*(?:my name is|my name's|name's|you can call me|call me|i am|i'm|im|it's|its|this is)\s+/i;
const AGENT_LEAD_INS = /^(?:how about|let's go with|lets go with|call yourself|your name is|your name will be|i'll call you|i will call you|name you|call you)\s+/i;
const TRAILING_PUNCTUATION = /[\s.,!?;:]+$/;
const WRAPPING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

// Letters (any script), combining marks, spaces, apostrophes, hyphens, periods.
const USER_NAME_CHARS = /^[\p{L}\p{M}' .\-’]+$/u;
const CONTROL_CHARS = /\p{Cc}/gu;
const URL_LIKE = /(?:[a-z]+:\/\/|www\.|\b[\w-]+\.(?:com|net|org|io|ai|co|app|dev|xyz)\b)/i;
const MARKUP = /[<>]/;

const JOKE_TOKENS = new Set([
  "xxx", "lol", "idk", "nobody", "anonymous", "batman", "superman", "voldemort", "santa",
  "god", "satan", "asdf", "test", "none", "null", "undefined",
]);
const JOKE_PHRASES = ["your mom", "ur mom", "mickey mouse"];
const JOKE_FRAGMENTS = ["poop", "fart", "butt"];

function titleCaseIfLower(word: string): string {
  if (word !== word.toLowerCase() || word.length === 0) return word;
  return word.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function normalizeSpaces(raw: string): string {
  return raw.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

function looksLikeJoke(name: string): boolean {
  const lower = name.toLowerCase();
  const tokens = lower.split(/[\s\-.]+/).filter(Boolean);
  if (name.split(" ").length > 3) return true;
  return (
    tokens.some((t) => JOKE_TOKENS.has(t)) ||
    JOKE_PHRASES.some((p) => lower.includes(p)) ||
    JOKE_FRAGMENTS.some((f) => lower.includes(f))
  );
}

export function validateUserName(raw: string): NameResult {
  const cleaned = normalizeSpaces(raw)
    .replace(USER_LEAD_INS, "")
    .replace(WRAPPING_QUOTES, "")
    .replace(TRAILING_PUNCTUATION, "")
    .replace(/\b(?:my name is|call me)$/i, "")
    .trim();
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (cleaned.length > USER_NAME_MAX) return { ok: false, reason: "too_long" };
  if (!USER_NAME_CHARS.test(cleaned)) return { ok: false, reason: "invalid_characters" };
  const value = cleaned.split(" ").map(titleCaseIfLower).join(" ");
  return { ok: true, value, needsConfirmation: looksLikeJoke(value) };
}

export function validateAgentName(raw: string): NameResult {
  const cleaned = normalizeSpaces(raw)
    .replace(AGENT_LEAD_INS, "")
    .replace(WRAPPING_QUOTES, "")
    .replace(/[\s,!?;:]+$/, "")
    .trim();
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (cleaned.length > AGENT_NAME_MAX) return { ok: false, reason: "too_long" };
  if (URL_LIKE.test(cleaned) || MARKUP.test(cleaned)) return { ok: false, reason: "invalid_characters" };
  const value = cleaned.split(" ").map(titleCaseIfLower).join(" ");
  return { ok: true, value, needsConfirmation: false };
}

export function validateHelpGoal(raw: string): GoalResult {
  const cleaned = normalizeSpaces(raw.replace(/[<>]/g, ""));
  if (cleaned.length < GOAL_MIN) return { ok: false, reason: "too_short" };
  return { ok: true, value: cleaned.slice(0, GOAL_MAX) };
}
