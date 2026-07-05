// Pure selection of the stored Cline auth/config from a parsed providers.json.
// The impure file read stays in the dispatcher; this function is the tested logic.
//
// Token/accountId come from the first token-bearing provider in precedence
// order: active provider, cline-pass, cline, then remaining providers. Display
// model/provider stay sourced from the active provider when configured.
export function selectClineAuth(providersJson) {
  const all = providersJson?.providers ?? {};
  const active = providersJson?.lastUsedProvider;
  const candidates = orderedCandidates(all, active);
  const authSettings = candidates.find((settings) => tokenFromSettings(settings)) ?? {};
  const displaySettings = all[active]?.settings ?? authSettings;
  const auth = authSettings.auth ?? {};

  return {
    token: tokenFromSettings(authSettings),
    accountId: auth.accountId ?? "",
    model: displaySettings.model ?? null,
    provider: displaySettings.provider ?? null,
    clinePassModel: all["cline-pass"]?.settings?.model ?? null,
  };
}

function orderedCandidates(all, active) {
  const candidates = [];
  const seen = new Set();

  const add = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    const settings = all[key]?.settings;
    if (settings) candidates.push(settings);
  };

  add(active);
  add("cline-pass");
  add("cline");
  for (const key of Object.keys(all)) add(key);

  return candidates;
}

function tokenFromSettings(settings) {
  const token = settings?.auth?.accessToken;
  return typeof token === "string" && token.trim() ? token : "";
}
