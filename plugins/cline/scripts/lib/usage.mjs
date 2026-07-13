import { formatUsd } from "./format.mjs";
import { shellQuote } from "./host-state.mjs";
import { formatLedgerSummary, summarizeLedger } from "./ledger.mjs";

const API_BASE_URL = "https://api.cline.bot/api/v1";

// Bound paginated usage fetches so a bad cursor chain cannot loop forever.
export const MAX_USAGE_PAGES = 20;

const WINDOWS = [
  { key: "24h", label: "Last 24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
];
const WINDOW_MS = Math.max(...WINDOWS.map((window) => window.ms));

// Strip the account-id path segment from an api.cline.bot URL before it
// reaches user-visible error text (data minimization).
export function redactAccountPath(url) {
  return String(url ?? "").replace(/\/users\/[^/?#]+/, "/users/[account]");
}

// The usage command handler. Pure orchestration over an injected `fetchJson`
// (the only impure edge) plus pure ClinePass usage summarising/formatting.
//
// deps.fetchJson(url, { token }) -> { success, data }
export async function usage(opts = {}, deps) {
  const token = String(opts.token ?? "").trim();
  if (!token) {
    if (opts.authStatus === "unreadable") {
      return {
        ok: false,
        text: `Your Cline settings file (${opts.authPath ?? "~/.cline/data/settings/providers.json"}) exists but could not be read. Fix or remove it, then run \`cline${opts.stateRoot ? ` --data-dir ${shellQuote(opts.stateRoot)}` : ""} auth cline\`.`,
      };
    }

    return {
      ok: false,
      text:
        opts.host === "codex"
          ? "Cline is not signed in to the Codex state directory. Run $cline:setup, then authenticate the isolated Cline state before retrying $cline:usage."
          : "Cline is not signed in. Run /cline:setup or sign in to Cline, then retry /cline:usage.",
    };
  }

  try {
    const accountId = await resolveAccountId(opts, deps.fetchJson, token);
    const encodedId = encodeURIComponent(accountId);
    const nowIso = opts.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    if (!Number.isFinite(nowMs)) {
      throw new Error(`Invalid nowIso: ${nowIso}`);
    }

    const balance = unwrapData(
      await deps.fetchJson(`${API_BASE_URL}/users/${encodedId}/balance`, { token }),
      "balance",
    );
    const usages = await fetchUsageItems(deps.fetchJson, token, encodedId, nowMs);

    const summary = summarizeUsage(
      {
        items: usages.items,
        partial: usages.truncated,
        partialNote: usages.truncated
          ? `(partial — history beyond ${MAX_USAGE_PAGES} pages not fetched)`
          : "",
      },
      nowIso,
    );

    let text = formatUsage({ balance, summary });
    if (Object.hasOwn(opts, "ledgerText")) {
      text = `${text}\n\n${formatLedgerSummary(
        summarizeLedger(opts.ledgerText, nowIso),
        opts.ledgerPath,
      )}`;
    }

    return { ok: true, text };
  } catch (error) {
    return {
      ok: false,
      text: `Could not load ClinePass usage: ${error.message}`,
    };
  }
}

async function fetchUsageItems(fetchJson, token, encodedId, nowMs) {
  const items = [];
  let pageCount = 0;
  let nextToken = null;
  let oldestPageItemMs = -Infinity;

  do {
    const cursor = pageCount === 0 ? "" : `?cursor=${encodeURIComponent(nextToken)}`;
    const response = await fetchJson(`${API_BASE_URL}/users/${encodedId}/usages${cursor}`, {
      token,
    });
    const data = unwrapData(response, "usages");
    const pageItems = Array.isArray(data.items) ? data.items : [];

    items.push(...pageItems);
    pageCount += 1;
    nextToken = data.nextToken;
    oldestPageItemMs = oldestItemMs(pageItems);
  } while (
    hasNextToken(nextToken) &&
    pageCount < MAX_USAGE_PAGES &&
    oldestPageItemMs >= nowMs - WINDOW_MS
  );

  return {
    items,
    truncated:
      hasNextToken(nextToken) &&
      pageCount >= MAX_USAGE_PAGES &&
      oldestPageItemMs >= nowMs - WINDOW_MS,
  };
}

export function summarizeUsage(usagesData, nowIso) {
  const data = usagesData?.data ?? usagesData ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  const nowMs = Date.parse(nowIso);

  if (!Number.isFinite(nowMs)) {
    throw new Error(`Invalid nowIso: ${nowIso}`);
  }

  const windows = Object.fromEntries(
    WINDOWS.map((window) => [
      window.key,
      {
        label: window.label,
        count: 0,
        creditsUsed: 0,
        costUsd: 0,
      },
    ]),
  );
  const costMicroUsd = Object.fromEntries(WINDOWS.map((window) => [window.key, 0]));

  for (const item of items) {
    const createdMs = Date.parse(item?.createdAt ?? "");
    if (!Number.isFinite(createdMs)) continue;

    for (const window of WINDOWS) {
      if (createdMs < nowMs - window.ms) continue;
      const current = windows[window.key];
      current.count += 1;
      current.creditsUsed += numberOrZero(item.creditsUsed);
      costMicroUsd[window.key] += numberOrZero(item.costUsd);
    }
  }

  for (const window of WINDOWS) {
    windows[window.key].costUsd = costMicroUsd[window.key] / 1_000_000;
  }

  const partial = typeof data.partial === "boolean" ? data.partial : hasNextToken(data.nextToken);
  return {
    partial,
    partialNote: partial ? data.partialNote || "(partial — more history not fetched)" : "",
    windows,
  };
}

export function formatUsage({ balance, summary }) {
  const balanceCredits = normalizeBalance(balance);
  const partialNote = summary.partialNote ? ` ${summary.partialNote}` : "";
  const lines = [
    "**ClinePass Usage**",
    "",
    `Credit balance: ${formatInteger(balanceCredits)} credits`,
    "",
    `**Recent usage${partialNote}**`,
  ];

  for (const window of WINDOWS) {
    const item = summary.windows[window.key];
    lines.push(
      `- ${item.label}: ${formatInteger(item.count)} items · ${formatInteger(
        item.creditsUsed,
      )} credits · ${formatUsd(item.costUsd)}`,
    );
  }

  lines.push(
    "",
    "For authoritative ClinePass 5h/weekly/monthly rate-limit windows, see https://app.cline.bot/dashboard/subscription.",
  );

  return lines.join("\n");
}

async function resolveAccountId(opts, fetchJson, token) {
  const accountId = String(opts.accountId ?? "").trim();
  if (accountId) return accountId;

  const me = unwrapData(await fetchJson(`${API_BASE_URL}/users/me`, { token }), "current user");
  if (!me?.id) {
    throw new Error("current user response did not include data.id");
  }
  return me.id;
}

function unwrapData(response, label) {
  if (response?.success !== true) {
    const detail = response?.error?.message ?? response?.message ?? "unsuccessful response";
    throw new Error(`${label} request failed: ${detail}`);
  }
  if (response.data == null) {
    throw new Error(`${label} response did not include data`);
  }
  return response.data;
}

function normalizeBalance(balance) {
  return numberOrZero(balance?.balance ?? balance);
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasNextToken(token) {
  return token != null && token !== "";
}

function oldestItemMs(items) {
  let oldest = -Infinity;
  for (const item of items) {
    const createdMs = Date.parse(item?.createdAt ?? "");
    if (Number.isFinite(createdMs) && (oldest === -Infinity || createdMs < oldest)) {
      oldest = createdMs;
    }
  }
  return oldest;
}

function formatInteger(value) {
  const n = numberOrZero(value);
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
