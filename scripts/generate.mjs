// scripts/generate.mjs
// Builds the profile visuals (SVG with embedded CSS) from live GitHub data.
// Run by the GitHub Action; `node scripts/generate.mjs --mock` renders sample data locally.

import fs from "node:fs/promises";

const TOKEN = process.env.GH_TOKEN;
const LOGIN = process.env.GH_LOGIN || "serious-capybara";
const OUT = "assets";
const MOCK = process.argv.includes("--mock");

// ─── Things you can edit ────────────────────────────────────────────────────
const CONFIG = {
  displayName: "dr.capybara",
  tagline: "Frontend and full-stack engineer",
  blurb: "I turn ideas into clean, useful software and build it in public.",
  chips: ["JavaScript", "HTML", "Kotlin"],
};

const C = {
  night: "#08161a",
  water: "#0d2428",
  edge: "#1d3d42",
  mint: "#86efac",
  teal: "#5eead4",
  amber: "#f2c879",
  text: "#e8f5ee",
  muted: "#7fa398",
  dim: "#16343a",
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmt = (n) => Number(n).toLocaleString("en-US");

function wrap(text, max, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, max - 1).trimEnd() + "…";
    return kept;
  }
  return lines;
}

function starPoints(cx, cy, R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// Small deterministic pseudo-random so the sky is the same on every run
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const baseCss = `
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.serif{font-family:Georgia,"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",serif}
.bd{transform-box:fill-box;transform-origin:50% 100%;animation:rise 1s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes rise{from{transform:scaleY(0)}}
.beacon{opacity:0;animation:beacon 3.4s ease-in-out infinite}
@keyframes beacon{0%,100%{opacity:0}50%{opacity:.5}}
.tw{animation:tw 4.5s ease-in-out infinite}
@keyframes tw{0%,100%{opacity:.12}50%{opacity:.6}}
@media (prefers-reduced-motion:reduce){.bd,.beacon,.tw{animation:none}}
`;

const shell = (w, h, title, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><style>${baseCss}</style><defs>${defs}</defs>${body}</svg>`;

const panel = (w, h) =>
  `<rect width="${w}" height="${h}" rx="18" fill="${C.night}"/>` +
  `<rect x=".75" y=".75" width="${w - 1.5}" height="${h - 1.5}" rx="17.25" fill="none" stroke="${C.edge}" stroke-width="1.5"/>`;

const clip = (id, w, h) => `<clipPath id="${id}"><rect width="${w}" height="${h}" rx="18"/></clipPath>`;

// ─── Data ───────────────────────────────────────────────────────────────────
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-readme-generator",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    const msg = JSON.stringify(json.errors);
    const hint = /forbidden|not accessible|resource/i.test(msg)
      ? "\nHint: add a PROFILE_TOKEN repo secret (a personal access token with public_repo + read:user)."
      : "";
    throw new Error(msg + hint);
  }
  return json.data.user;
}

const QUERY = `
query($login: String!) {
  user(login: $login) {
    login
    avatarUrl
    followers { totalCount }
    repositories(first: 100, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 8, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    pinnedItems(first: 6, types: [REPOSITORY]) {
      nodes {
        ... on Repository {
          name url description stargazerCount forkCount
          primaryLanguage { name color }
        }
      }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function avatarDataUri(url) {
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "s=240");
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${r.headers.get("content-type") || "image/png"};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function mockUser() {
  const rand = rng(42);
  const start = new Date(Date.UTC(2025, 9, 26));
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const contributionDays = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
      const r = rand();
      const burst = Math.sin(w / 5) > 0.3 ? 1.8 : 1;
      const count = r < 0.35 ? 0 : Math.floor(r * r * 16 * burst);
      contributionDays.push({ date: date.toISOString().slice(0, 10), contributionCount: count });
    }
    weeks.push({ contributionDays });
  }
  return {
    login: LOGIN,
    avatarUrl: "",
    followers: { totalCount: 8 },
    repositories: {
      totalCount: 16,
      nodes: [
        { stargazerCount: 1, languages: { edges: [
          { size: 52000, node: { name: "JavaScript", color: "#f1e05a" } },
          { size: 31000, node: { name: "HTML", color: "#e34c26" } },
          { size: 26000, node: { name: "Kotlin", color: "#A97BFF" } },
          { size: 9000, node: { name: "CSS", color: "#663399" } },
          { size: 4000, node: { name: "TypeScript", color: "#3178c6" } },
          { size: 1500, node: { name: "Shell", color: "#89e051" } },
          { size: 700, node: { name: "Java", color: "#b07219" } },
        ] } },
      ],
    },
    pinnedItems: { nodes: [
      { name: "g-link-app", url: "#", description: null, stargazerCount: 0, forkCount: 0, primaryLanguage: { name: "Kotlin", color: "#A97BFF" } },
      { name: "g-link-extension", url: "#", description: "", stargazerCount: 0, forkCount: 0, primaryLanguage: { name: "JavaScript", color: "#f1e05a" } },
      { name: "managing-sentry", url: "#", description: "Managing Sentry: A dedicated Point of Sale and Inventory Management solution for Alekos Corner General Merchandise, digitizing daily operations and eliminating paper-based errors.", stargazerCount: 0, forkCount: 0, primaryLanguage: { name: "JavaScript", color: "#f1e05a" } },
      { name: "PHINMA-Education-Media-Directory", url: "#", description: "PHINMAEducationMediaDirectory is a student-initiated web project that centralizes official websites, emails, and social media pages of PHINMA-affiliated schools. It organizes links through a clear academic hierarchy to make school information easier to find.", stargazerCount: 1, forkCount: 0, primaryLanguage: { name: "HTML", color: "#e34c26" } },
    ] },
    contributionsCollection: { contributionCalendar: { totalContributions: 717, weeks } },
  };
}

// ─── Renderers ──────────────────────────────────────────────────────────────
function renderHero(user, avatar) {
  const W = 1200, H = 310;
  const chips = CONFIG.chips.map((t) => ({ t, w: Math.round(t.length * 8.6 + 30) }));
  let cx = 270;
  const chipSvg = chips
    .map((c) => {
      const out =
        `<rect x="${cx}" y="252" width="${c.w}" height="30" rx="15" fill="${C.water}" stroke="${C.edge}"/>` +
        `<text x="${cx + c.w / 2}" y="272" text-anchor="middle" font-size="14" fill="${C.mint}">${esc(c.t)}</text>`;
      cx += c.w + 10;
      return out;
    })
    .join("");

  const waves = [
    { y: 244, o: 0.035 },
    { y: 262, o: 0.045 },
    { y: 282, o: 0.06 },
  ]
    .map(
      (w) =>
        `<path d="M0 ${w.y} C200 ${w.y - 20} 400 ${w.y + 20} 600 ${w.y} S1000 ${w.y - 20} 1200 ${w.y} V${H} H0 Z" fill="${C.mint}" fill-opacity="${w.o}"/>`
    )
    .join("");

  const face = avatar
    ? `<image href="${avatar}" x="76" y="76" width="148" height="148" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="150" cy="150" r="74" fill="${C.water}"/><text x="150" y="168" text-anchor="middle" font-size="52" class="serif" fill="${C.mint}">${esc(CONFIG.displayName.slice(0, 2))}</text>`;

  const defs =
    clip("card", W, H) +
    `<clipPath id="av"><circle cx="150" cy="150" r="74"/></clipPath>` +
    `<radialGradient id="glow" cx="150" cy="150" r="260" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.teal}" stop-opacity=".18"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.mint}"/><stop offset="1" stop-color="${C.teal}"/></linearGradient>`;

  const body =
    panel(W, H) +
    `<g clip-path="url(#card)"><rect width="${W}" height="${H}" fill="url(#glow)"/>${waves}</g>` +
    `<circle cx="150" cy="150" r="80" fill="none" stroke="url(#ring)" stroke-width="3"/>` +
    face +
    `<text x="270" y="98" font-size="17" fill="${C.muted}">@${esc(user.login)}</text>` +
    `<text x="268" y="162" font-size="60" class="serif" fill="${C.text}">${esc(CONFIG.displayName)}</text>` +
    `<text x="270" y="202" font-size="22" fill="${C.mint}">${esc(CONFIG.tagline)}</text>` +
    `<text x="270" y="232" font-size="17" fill="${C.muted}">${esc(CONFIG.blurb)}</text>` +
    chipSvg;

  return shell(W, H, `${CONFIG.displayName} — ${CONFIG.tagline}`, defs, body);
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const shade = (hex, k) => mix("#000000", hex, k);

// Isometric city: one block per day. Weeks run down-right, weekdays run down-left.
function renderSkyline(cal) {
  const W = 1200, H = 550;
  const a = 18, b = 6.5, maxH = 105, s = 0.72;
  const ox = 600 - 23 * a, oy = maxH + 30;

  const days = [];
  cal.weeks.forEach((w, i) =>
    w.contributionDays.forEach((d) =>
      days.push({ i, j: new Date(d.date + "T00:00:00Z").getUTCDay(), n: d.contributionCount })
    )
  );
  const max = Math.max(1, ...days.map((d) => d.n));
  const pt = (x, y) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const center = (d) => [ox + (d.i - d.j) * a, oy + (d.i + d.j) * b + b];
  const LOW = "#1f8a7c", HIGH = "#9bf7c0";

  // Floor tiles
  const floor = days
    .map((d) => {
      const [cx, cy] = center(d);
      return `<polygon points="${pt(cx, cy - b)} ${pt(cx + a, cy)} ${pt(cx, cy + b)} ${pt(cx - a, cy)}"/>`;
    })
    .join("");

  // Buildings, drawn back to front
  const built = days
    .filter((d) => d.n > 0)
    .sort((p, q) => p.i + p.j - (q.i + q.j) || p.i - q.i);
  const tall = new Set([...built].sort((p, q) => q.n - p.n).slice(0, 10));
  let beaconIdx = 0;

  const buildings = built
    .map((d) => {
      const t = d.n / max;
      const h = 6 + Math.pow(t, 0.85) * (maxH - 6);
      const top = mix(LOW, HIGH, Math.pow(t, 0.7));
      const left = shade(top, 0.62), right = shade(top, 0.42);
      const [cx, cy] = center(d);
      const hw = a * s, hh = b * s;
      const T = [cx, cy - hh], R = [cx + hw, cy], B = [cx, cy + hh], L = [cx - hw, cy];
      const up = (p) => [p[0], p[1] - h];
      const poly = (pts, fill) =>
        `<polygon points="${pts.map((p) => pt(p[0], p[1])).join(" ")}" fill="${fill}" stroke="${fill}" stroke-width=".6" stroke-linejoin="round"/>`;
      const delay = Math.round((d.i + d.j * 0.6) * 14);
      const beacon = tall.has(d)
        ? `<polygon class="beacon" points="${[up(T), up(R), up(B), up(L)].map((p) => pt(p[0], p[1])).join(" ")}" fill="#ffffff" style="animation-delay:${1800 + beaconIdx++ * 420}ms"/>`
        : "";
      return (
        `<g class="bd" style="animation-delay:${delay}ms">` +
        poly([L, B, up(B), up(L)], left) +
        poly([B, R, up(R), up(B)], right) +
        poly([up(T), up(R), up(B), up(L)], top) +
        beacon +
        `</g>`
      );
    })
    .join("");

  // Twinkling stars (kept clear of the text areas)
  const rand = rng(7);
  let stars = "";
  for (let k = 0; k < 40; k++) {
    const x = 20 + rand() * (W - 40);
    const y = 16 + rand() * 230;
    if (x < 480 && y > H - 140) continue;
    if (x > 880 && y < 76) continue;
    stars += `<circle class="tw" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(0.7 + rand() * 0.8).toFixed(1)}" fill="${C.text}" style="opacity:.35;animation-delay:${Math.round(rand() * 4000)}ms"/>`;
  }

  // Legend (top right)
  const sq = 1016;
  const legend =
    `<text x="${sq - 8}" y="49" text-anchor="end" font-size="13" fill="${C.muted}">Less</text>` +
    [0, 0.25, 0.5, 0.75, 1]
      .map((t, k) => `<rect x="${sq + k * 20}" y="38" width="14" height="14" rx="3" fill="${mix(LOW, HIGH, t)}"/>`)
      .join("") +
    `<text x="${sq + 106}" y="49" font-size="13" fill="${C.muted}">More</text>`;

  const defs =
    clip("card", W, H) +
    `<radialGradient id="glow" cx="600" cy="300" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.teal}" stop-opacity=".12"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="moon" cx="64" cy="54" r="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.amber}" stop-opacity=".28"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient>`;

  const body =
    panel(W, H) +
    `<g clip-path="url(#card)"><rect width="${W}" height="${H}" fill="url(#glow)"/>${stars}<circle cx="64" cy="54" r="60" fill="url(#moon)"/><circle cx="64" cy="54" r="13" fill="${C.amber}"/></g>` +
    `<g fill="${C.water}" stroke="${C.edge}" stroke-width="1">${floor}</g>` +
    buildings +
    legend +
    `<text x="40" y="${H - 74}" font-size="26" class="serif" fill="${C.text}">${fmt(cal.totalContributions)} contributions in the past year</text>` +
    `<text x="40" y="${H - 48}" font-size="14" fill="${C.muted}">Each building is one day. Taller means more activity.</text>`;

  return shell(W, H, `${cal.totalContributions} contributions in the past year, drawn as an isometric city`, defs, body);
}

function renderStats(user, cal) {
  const W = 1200, H = 150;
  const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
  const items = [
    { v: stars, label: "Stars earned", color: C.amber },
    { v: cal.totalContributions, label: "Contributions this year", color: C.mint },
    { v: user.repositories.totalCount, label: "Public repositories", color: C.mint },
    { v: user.followers.totalCount, label: "Followers", color: C.mint },
  ];
  const colW = W / items.length;
  const body =
    panel(W, H) +
    items
      .map((it, i) => {
        const x = colW * i + colW / 2;
        const divider = i
          ? `<rect x="${colW * i}" y="34" width="1.5" height="82" fill="${C.edge}"/>`
          : "";
        return (
          divider +
          `<text x="${x}" y="88" text-anchor="middle" font-size="54" class="serif" fill="${it.color}">${fmt(it.v)}</text>` +
          `<text x="${x}" y="116" text-anchor="middle" font-size="15" fill="${C.muted}">${esc(it.label)}</text>`
        );
      })
      .join("");
  return shell(W, H, "GitHub stats", "", body);
}

function renderProjects(repos) {
  const cardW = 586, cardH = 160, gapX = 24, gapY = 20, x0 = 2, y0 = 2;
  const W = 1200;
  const rows = Math.max(1, Math.ceil(repos.length / 2));
  const H = rows * cardH + (rows - 1) * gapY + 4;

  if (!repos.length) {
    return shell(W, 100, "Featured projects", "",
      panel(W, 100) + `<text x="40" y="58" font-size="17" fill="${C.muted}">Pin up to six repositories on your profile and they will show up here.</text>`);
  }

  const cards = repos
    .map((r, i) => {
      const x = x0 + (i % 2) * (cardW + gapX);
      const y = y0 + Math.floor(i / 2) * (cardH + gapY);
      const lang = r.primaryLanguage;
      const lc = lang?.color || C.muted;
      const name = r.name.length > 36 ? r.name.slice(0, 35) + "…" : r.name;
      const desc = r.description ? wrap(r.description, 62, 2) : [];
      const descSvg = desc.length
        ? desc.map((l, j) => `<text x="${x + 30}" y="${y + 78 + j * 22}" font-size="15" fill="${C.muted}">${esc(l)}</text>`).join("")
        : `<text x="${x + 30}" y="${y + 78}" font-size="15" fill="${C.muted}" fill-opacity=".6">No description yet.</text>`;

      const fy = y + 138;
      let fx = x + 30;
      let footer = "";
      if (lang) {
        footer += `<circle cx="${fx + 5}" cy="${fy - 5}" r="5" fill="${lc}"/><text x="${fx + 18}" y="${fy}" font-size="14" fill="${C.text}">${esc(lang.name)}</text>`;
        fx += 18 + lang.name.length * 7.6 + 26;
      }
      footer += `<polygon points="${starPoints(fx + 7, fy - 6, 7, 3)}" fill="${C.amber}"/><text x="${fx + 20}" y="${fy}" font-size="14" fill="${C.muted}">${fmt(r.stargazerCount)}</text>`;
      fx += 20 + String(r.stargazerCount).length * 8 + 22;
      footer +=
        `<g fill="none" stroke="${C.muted}" stroke-width="1.5">` +
        `<circle cx="${fx + 2}" cy="${fy - 13}" r="2"/><circle cx="${fx + 12}" cy="${fy - 13}" r="2"/><circle cx="${fx + 7}" cy="${fy - 1}" r="2"/>` +
        `<path d="M${fx + 2} ${fy - 11} V${fy - 8} Q${fx + 2} ${fy - 6} ${fx + 7} ${fy - 6} Q${fx + 12} ${fy - 6} ${fx + 12} ${fy - 8} V${fy - 11} M${fx + 7} ${fy - 6} V${fy - 3}"/></g>` +
        `<text x="${fx + 22}" y="${fy}" font-size="14" fill="${C.muted}">${fmt(r.forkCount)}</text>`;

      return (
        `<a href="${esc(r.url)}">` +
        `<g clip-path="url(#c${i})">` +
        `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" fill="${C.water}"/>` +
        `<rect x="${x}" y="${y}" width="5" height="${cardH}" fill="${lc}"/>` +
        `</g>` +
        `<rect x="${x + 0.75}" y="${y + 0.75}" width="${cardW - 1.5}" height="${cardH - 1.5}" rx="14" fill="none" stroke="${C.edge}" stroke-width="1.5"/>` +
        `<text x="${x + 30}" y="${y + 46}" font-size="23" class="serif" fill="${C.text}">${esc(name)}</text>` +
        descSvg +
        footer +
        `</a>`
      );
    })
    .join("");

  const defs = repos
    .map((_, i) => {
      const x = x0 + (i % 2) * (cardW + gapX);
      const y = y0 + Math.floor(i / 2) * (cardH + gapY);
      return `<clipPath id="c${i}"><rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="14"/></clipPath>`;
    })
    .join("");

  return shell(W, H, "Featured projects", defs, cards);
}

function renderStack(user) {
  const W = 1200, H = 216;
  const totals = new Map();
  for (const repo of user.repositories.nodes)
    for (const e of repo.languages.edges) {
      const cur = totals.get(e.node.name) || { size: 0, color: e.node.color };
      cur.size += e.size;
      totals.set(e.node.name, cur);
    }
  const all = [...totals.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.size - a.size);
  const sum = all.reduce((s, l) => s + l.size, 0) || 1;
  const top = all.slice(0, 6);
  const fallback = ["#86efac", "#5eead4", "#f2c879", "#7dd3fc", "#c4b5fd", "#fda4af"];

  const left = 40, barW = 1120;
  let x = left;
  let segs = "";
  top.forEach((l, i) => {
    l.color = l.color || fallback[i % fallback.length];
    const w = (l.size / sum) * barW;
    segs += `<rect x="${x.toFixed(2)}" y="92" width="${Math.max(w - 3, 2).toFixed(2)}" height="16" rx="8" fill="${l.color}"/>`;
    x += w;
  });

  const legend = top
    .map((l, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const lx = left + col * 380;
      const ly = 150 + row * 32;
      const pct = (l.size / sum) * 100;
      return `<circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${l.color}"/><text x="${lx + 22}" y="${ly}" font-size="16" fill="${C.text}">${esc(l.name)}</text><text x="${lx + 250}" y="${ly}" text-anchor="end" font-size="16" fill="${C.muted}">${pct < 1 ? "<1" : Math.round(pct)}%</text>`;
    })
    .join("");

  const body =
    panel(W, H) +
    `<text x="40" y="52" font-size="24" class="serif" fill="${C.text}">Languages I write most</text>` +
    `<text x="40" y="76" font-size="14" fill="${C.muted}">Share of code across my public repositories.</text>` +
    segs +
    legend;
  return shell(W, H, "Most used languages", "", body);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!MOCK && !TOKEN) throw new Error("GH_TOKEN is not set");
  const user = MOCK ? mockUser() : await gql(QUERY, { login: LOGIN });
  const avatar = MOCK ? null : await avatarDataUri(user.avatarUrl);
  const cal = user.contributionsCollection.contributionCalendar;

  await fs.mkdir(OUT, { recursive: true });
  const files = {
    "hero.svg": renderHero(user, avatar),
    "contributions.svg": renderSkyline(cal),
    "stats.svg": renderStats(user, cal),
    "projects.svg": renderProjects(user.pinnedItems.nodes),
    "stack.svg": renderStack(user),
  };
  for (const [name, svg] of Object.entries(files)) await fs.writeFile(`${OUT}/${name}`, svg);
  console.log(`Wrote ${Object.keys(files).length} files to ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
