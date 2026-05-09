const now = new Date();
const min = (n: number) => new Date(now.getTime() - n * 60_000);
const hr = (n: number) => new Date(now.getTime() - n * 3_600_000);
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);

export const systemPrompt = `You are PostHog's documentation assistant. You help developers integrate PostHog into their products.

Rules:
- Always cite sources from the indexed docs using inline numbered references [1], [2].
- Prefer code examples in TypeScript unless the user asks otherwise.
- If a question requires account-specific data (org settings, billing, team members), do not guess — direct the user to support@posthog.com.
- Be concise. Aim for under 200 words unless the user asks for depth.
- Never invent feature names or API methods. If you're not sure, say so.

Tone: technical, precise, friendly but not chatty. Match the reader's expertise.`;

export const docs = [
  { id: "d1", title: "Feature Flags / Creating your first flag", path: "docs/feature-flags/creating-flags.md", tokens: 1842, updated: day(2) },
  { id: "d2", title: "Feature Flags / Multivariate flags", path: "docs/feature-flags/multivariate.md", tokens: 1204, updated: day(2) },
  { id: "d3", title: "Feature Flags / Local evaluation", path: "docs/feature-flags/local-eval.md", tokens: 980, updated: day(5) },
  { id: "d4", title: "JavaScript Web SDK / Installation", path: "docs/libraries/js/install.md", tokens: 1456, updated: day(11) },
  { id: "d5", title: "JavaScript Web SDK / Identifying users", path: "docs/libraries/js/identify.md", tokens: 1112, updated: day(11) },
  { id: "d6", title: "Session Replay / Privacy controls", path: "docs/session-replay/privacy.md", tokens: 2031, updated: day(3) },
  { id: "d7", title: "Session Replay / Masking sensitive elements", path: "docs/session-replay/masking.md", tokens: 1340, updated: day(3) },
  { id: "d8", title: "Insights / SQL queries (HogQL)", path: "docs/product-analytics/hogql.md", tokens: 3204, updated: day(1) },
  { id: "d9", title: "Cohorts / Behavioral cohorts", path: "docs/product-analytics/cohorts.md", tokens: 1876, updated: day(7) },
  { id: "d10", title: "Surveys / Targeting users", path: "docs/surveys/targeting.md", tokens: 1244, updated: day(4) },
  { id: "d11", title: "Experiments / Setting up an A/B test", path: "docs/experiments/setup.md", tokens: 2587, updated: day(2) },
  { id: "d12", title: "Self-hosting / Docker deployment", path: "docs/self-host/docker.md", tokens: 4102, updated: day(18) },
  { id: "d13", title: "Self-hosting / Migrating to Cloud", path: "docs/self-host/migrate.md", tokens: 1923, updated: day(18) },
  { id: "d14", title: "API / Capture events", path: "docs/api/capture.md", tokens: 2110, updated: day(6) },
  { id: "d15", title: "API / Authentication", path: "docs/api/auth.md", tokens: 870, updated: day(9) },
  { id: "d16", title: "Pricing / Usage-based billing", path: "docs/pricing/usage.md", tokens: 1455, updated: day(15) },
];

export const tokensByHour = [
  412, 280, 196, 168, 122, 154, 320, 1240, 2980, 4310, 5120, 4870,
  3920, 4560, 5240, 5810, 5390, 4720, 3210, 2140, 1480, 980, 720, 540,
];
export const todayTokens = tokensByHour.reduce((a, b) => a + b, 0);
export const todayLimit = 80000;

export const sessions = [
  { id: "sess_8f3a91b2", user: "anonymous · Chrome / macOS", started: min(2), turns: 4, tokens: 12840, status: "active" },
  { id: "sess_a1c47e09", user: "user_92341 · Safari / iOS", started: min(7), turns: 2, tokens: 5210, status: "active" },
  { id: "sess_4d2b8f51", user: "anonymous · Firefox / Linux", started: min(14), turns: 8, tokens: 28940, status: "active" },
  { id: "sess_6e0a3d77", user: "user_18402 · Chrome / Windows", started: min(22), turns: 1, tokens: 3120, status: "active" },
  { id: "sess_bc94f2a3", user: "anonymous · Edge / Windows", started: min(31), turns: 6, tokens: 19400, status: "active" },
];

export type Turn = {
  role: "user" | "assistant" | "tool";
  text?: string;
  name?: string;
  query?: string;
  result?: string;
  tokens?: number;
  citations?: { n: number; doc: string; title: string; anchor?: string }[];
  ts?: Date;
};

export const featuredConvo = {
  id: "sess_8f3a91b2",
  user: "anonymous",
  started: min(2),
  title: "Feature flags rollout question",
  turns: [
    { role: "user" as const, text: "How do I roll out a feature flag to 25% of users in our EU region only?", ts: min(2) },
    { role: "tool" as const, name: "search_knowledge_base", query: "feature flags percentage rollout region targeting", result: "4 documents matched · 0.31s", ts: min(2) },
    {
      role: "assistant" as const, ts: min(2), tokens: 487,
      text: `You can do this with **release conditions** on a feature flag.\n\n1. Create the flag in **Feature flags → New flag** [1].\n2. Add a release condition with two filters:\n   - \`$geoip_country_code\` is in \`["DE","FR","IT","ES",...]\` (or use the EU country group)\n   - Roll out to \`25%\` of users matching this condition\n\nFor server-side flag evaluation, make sure you're passing \`geoip_country_code\` into the \`getAllFlags\` payload, since local evaluation can't resolve geo on its own [3].\n\nA quick TypeScript example:\n\n\`\`\`ts\nconst enabled = await posthog.isFeatureEnabled(\n  'eu-checkout-redesign',\n  distinctId,\n  { groups, personProperties: { $geoip_country_code: 'DE' } }\n);\n\`\`\``,
      citations: [
        { n: 1, doc: "d1", title: "Feature Flags / Creating your first flag", anchor: "#release-conditions" },
        { n: 3, doc: "d3", title: "Feature Flags / Local evaluation", anchor: "#geo-properties" },
      ],
    },
    { role: "user" as const, text: "Got it. Does that count against my MTU limit if the flag never evaluates true?", ts: min(1) },
    { role: "tool" as const, name: "search_knowledge_base", query: "feature flag MTU billing evaluation", result: "2 documents matched · 0.28s", ts: min(1) },
    {
      role: "assistant" as const, ts: min(1), tokens: 312,
      text: `Yes — MTU is counted on **flag requests**, not on \`true\` results [16]. Every \`isFeatureEnabled\` call from a unique user in the billing period counts toward MTU regardless of the outcome.\n\nTwo ways to keep this in check:\n- Use **local evaluation** so the SDK resolves flags client-side without hitting our endpoint for every request [3].\n- Add a release condition that filters out users you don't care about *before* the request, e.g. only evaluate for logged-in users.`,
      citations: [
        { n: 16, doc: "d16", title: "Pricing / Usage-based billing", anchor: "#mtu" },
        { n: 3, doc: "d3", title: "Feature Flags / Local evaluation", anchor: "#what-counts" },
      ],
    },
  ] as Turn[],
};

export const conversations = [
  { id: "sess_8f3a91b2", preview: "How do I roll out a feature flag to 25% of users in our EU region only?", user: "anonymous", when: min(2), turns: 4, tokens: 12840, resolved: false, tag: "feature-flags" },
  { id: "sess_a1c47e09", preview: "Can session replay mask credit-card inputs automatically?", user: "user_92341", when: min(7), turns: 2, tokens: 5210, resolved: true, tag: "session-replay" },
  { id: "sess_4d2b8f51", preview: "HogQL query for retention by signup cohort, weekly buckets", user: "anonymous", when: min(14), turns: 8, tokens: 28940, resolved: true, tag: "hogql" },
  { id: "sess_6e0a3d77", preview: "Difference between identify() and alias()?", user: "user_18402", when: min(22), turns: 1, tokens: 3120, resolved: true, tag: "sdk" },
  { id: "sess_bc94f2a3", preview: "Self-host vs cloud: data residency in Germany?", user: "anonymous", when: min(31), turns: 6, tokens: 19400, resolved: false, tag: "self-host" },
  { id: "sess_72e4a801", preview: "My experiment results show no significance after 3 weeks — is the implementation wrong?", user: "user_31099", when: hr(2), turns: 11, tokens: 41200, resolved: true, tag: "experiments" },
  { id: "sess_3f0d18cc", preview: "Capture events from a Cloudflare Worker — which library?", user: "anonymous", when: hr(3), turns: 3, tokens: 7800, resolved: true, tag: "sdk" },
  { id: "sess_19a8b3e2", preview: "How do I rotate the project API key without breaking production?", user: "user_88210", when: hr(4), turns: 5, tokens: 14300, resolved: true, tag: "api" },
  { id: "sess_e0c7d44f", preview: "Survey targeting based on a behavioral cohort — possible?", user: "anonymous", when: hr(5), turns: 4, tokens: 11900, resolved: true, tag: "surveys" },
  { id: "sess_aa1e92b6", preview: "Multivariate flag with 4 variants, weights not equal — how to set?", user: "user_47012", when: hr(7), turns: 2, tokens: 6420, resolved: true, tag: "feature-flags" },
  { id: "sess_5b3c00e1", preview: "Migrating from self-hosted (v1.43) to cloud — what breaks?", user: "user_03398", when: hr(9), turns: 14, tokens: 52800, resolved: false, tag: "self-host" },
  { id: "sess_d2f4a710", preview: "Why is $current_url showing as undefined in some events?", user: "anonymous", when: hr(11), turns: 6, tokens: 18200, resolved: true, tag: "sdk" },
];

export const apiKeys = [
  { id: "k1", label: "Production", token: "phk_live_a8f4e2c91b...3d72", created: day(94), lastUsed: min(1), env: "production" },
  { id: "k2", label: "Staging", token: "phk_test_71b203e9c4...8f10", created: day(94), lastUsed: hr(6), env: "staging" },
  { id: "k3", label: "Local dev (Marius)", token: "phk_test_4e2018ac7d...9b22", created: day(28), lastUsed: hr(31), env: "development" },
];

export function fmtRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dy = Math.floor(h / 24);
  return `${dy}d ago`;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
