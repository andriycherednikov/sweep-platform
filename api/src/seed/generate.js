/* ============================================================
   THE SWEEP — deterministic seed data generator
   Ported from web/src/data.js. The generation logic below is
   unchanged; only the final export is replaced with a pure
   generate() returning the shapes the DB seed consumes.
   ============================================================ */
import { strengthFor } from '../data/strengths.js'

// ---- seeded RNG (mulberry32) ----
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260613);

// ---- teams: [name, iso, strength, colour] grouped A..L ----
// pool: first 2 of each group = A, last 2 = B (sweep's own split)
const GROUPS = {
  A: [["Argentina","ar",90,"#5fa3e0"],["Poland","pl",70,"#d6334a"],["Saudi Arabia","sa",58,"#1c7a44"],["Mexico","mx",75,"#127a3e"]],
  B: [["France","fr",89,"#2a4bd0"],["Senegal","sn",73,"#1f9e54"],["Australia","au",66,"#d4af1e"],["Denmark","dk",74,"#c1304a"]],
  C: [["Brazil","br",88,"#f3c318"],["Serbia","rs",69,"#c0394b"],["Cameroon","cm",64,"#1f8a4c"],["Switzerland","ch",72,"#d62828"]],
  D: [["England","gb-eng",85,"#dd3b3b"],["Wales","gb-wls",63,"#c43030"],["Iran","ir",61,"#2f9e54"],["USA","us",71,"#3b5bdb"]],
  E: [["Germany","de",84,"#3a3a3a"],["Costa Rica","cr",57,"#c23a52"],["Ecuador","ec",65,"#e0b020"],["Canada","ca",67,"#d83a3a"]],
  F: [["Netherlands","nl",82,"#e87722"],["Qatar","qa",55,"#7a1f3d"],["Tunisia","tn",62,"#d62828"],["Colombia","co",76,"#f0c419"]],
  G: [["Portugal","pt",83,"#2e7d4f"],["Egypt","eg",64,"#c0392b"],["Norway","no",70,"#3457b0"],["South Africa","za",60,"#1f8a4c"]],
  H: [["Spain","es",86,"#d62828"],["Uruguay","uy",74,"#5aa2e0"],["Japan","jp",73,"#2d4fb0"],["Morocco","ma",75,"#1f7a44"]],
  I: [["Italy","it",81,"#2f6fd0"],["Nigeria","ng",69,"#1f9e54"],["Peru","pe",59,"#d23a4a"],["Sweden","se",71,"#e0b324"]],
  J: [["Turkey","tr",70,"#d62828"],["Chile","cl",66,"#c2384a"],["Algeria","dz",63,"#1f8a4c"],["Greece","gr",61,"#3a6fd0"]],
  K: [["Austria","at",72,"#d23a3a"],["Paraguay","py",58,"#c0394b"],["Ivory Coast","ci",67,"#e87722"],["New Zealand","nz",54,"#3a3a3a"]],
  L: [["Croatia","hr",80,"#d8334a"],["Belgium","be",78,"#e0b020"],["South Korea","kr",72,"#2f6fd0"],["Ghana","gh",65,"#1f8a4c"]]
};

const teams = {};
Object.keys(GROUPS).forEach(function (g) {
  GROUPS[g].forEach(function (t, i) {
    teams[t[1]] = {
      code: t[1], name: t[0], group: g, strength: strengthFor(t[1], t[2]), color: t[3],
      pool: i < 2 ? "A" : "B", win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0, played: 0
    };
  });
});
function team(code){ return teams[code]; }

// flag url helper
function flag(code, size) {
  size = size || 80;
  if (code.indexOf("gb-") === 0) return "https://flagcdn.com/" + code + ".svg";
  return "https://flagcdn.com/w" + size + "/" + code + ".png";
}

// ---- people (16) ----
const people = [
  { name: "James",              teams: ["ar","dk"] },
  { name: "Leonard Cherednikov",teams: ["ar","jp"] },
  { name: "Sofia",              teams: ["ar","eg"] },
  { name: "Wei",                teams: ["mx","tn"] },
  { name: "Andriy Cherednikov", teams: ["fr","hr"] },
  { name: "Priya",              teams: ["hr","br"] },
  { name: "Jax",                teams: ["pt","gh"] },
  { name: "Tom",                teams: ["es","no"] },
  { name: "Nina",               teams: ["es","au"] },
  { name: "Marco",              teams: ["it","ma"] },
  { name: "Hannah",             teams: ["gb-eng","kr"] },
  { name: "Diego",              teams: ["br","pe"] },
  { name: "Sam",                teams: ["nl","ca"] },
  { name: "Olivia",             teams: ["be","ng"] },
  { name: "Raj",                teams: ["pt","sa"] },
  { name: "Beck",               teams: ["uy","gb-wls"] }
];
// avatar colour + initials
const AV_COLORS = ["#d2342a","#3b6fd1","#0a6b3b","#7a4fd1","#c9472f","#1f7a8c","#b5562a","#5a4fd1","#2a8f6a","#c23a6a"];
people.forEach(function (p, i) {
  p.id = "p" + i;
  var parts = p.name.split(" ");
  p.initials = parts.length > 1 ? (parts[0][0] + parts[1][0]) : parts[0].slice(0, 2);
  p.short = parts.length > 1 ? parts[0] + " " + parts[1][0] + "." : parts[0];
  p.av = AV_COLORS[i % AV_COLORS.length];
});

// ownership map: teamCode -> [people]
const ownersByTeam = {};
people.forEach(function (p) {
  p.teams.forEach(function (tc) {
    (ownersByTeam[tc] = ownersByTeam[tc] || []).push(p);
  });
});
function ownersOf(code){ return ownersByTeam[code] || []; }
Object.keys(teams).forEach(function (c) { teams[c].owners = ownersByTeam[c] || []; });

// ---- venues ----
const VENUES = [
  ["MetLife Stadium","New York / NJ"],["SoFi Stadium","Los Angeles"],["AT&T Stadium","Dallas"],
  ["NRG Stadium","Houston"],["Mercedes-Benz Stadium","Atlanta"],["Hard Rock Stadium","Miami"],
  ["Lumen Field","Seattle"],["Levi's Stadium","San Francisco Bay"],["Arrowhead Stadium","Kansas City"],
  ["Gillette Stadium","Boston"],["Lincoln Financial Field","Philadelphia"],["BMO Field","Toronto"],
  ["BC Place","Vancouver"],["Estadio Azteca","Mexico City"],["Estadio Akron","Guadalajara"],["Estadio BBVA","Monterrey"]
];

// ---- generate fixtures (round robin per group) ----
// round robin order for 4 teams [0,1,2,3]:
// MD1: 0-1, 2-3   MD2: 0-2, 3-1   MD3: 0-3, 1-2
const RR = [ [[0,1],[2,3]], [[0,2],[3,1]], [[0,3],[1,2]] ];
// ---- per-group match dates (spread across the Sydney calendar) ----
// featured groups A/H/L play matchday 3 TODAY (Sat 13 Jun); others spread after.
const FEATURED = { A:true, H:true, L:true };
const md3 = {}; var _k = 0;
Object.keys(GROUPS).forEach(function (g) {
  if (FEATURED[g]) md3[g] = 13; else { md3[g] = 14 + (_k % 4); _k++; }
});
function mdDate(g, mdIdx) {
  var day = md3[g] - (2 - mdIdx) * 3;   // md1 = md3-6, md2 = md3-3, md3 = md3
  return "2026-06-" + String(day).padStart(2, "0");
}
const SLOTS = ["03:30", "09:30"]; // UTC -> Sydney 13:30 & 19:30

function scoreFor(a, b, r) {
  var diff = (team(a).strength - team(b).strength) / 16;
  var ga = Math.max(0, Math.round(1.1 + diff * 0.6 + (r() - 0.45) * 2.2));
  var gb = Math.max(0, Math.round(1.1 - diff * 0.6 + (r() - 0.45) * 2.2));
  return [Math.min(ga, 5), Math.min(gb, 5)];
}
function probFor(a, b) {
  var sa = team(a).strength, sb = team(b).strength;
  var raw = Math.pow(sa, 1.25) / (Math.pow(sa, 1.25) + Math.pow(sb, 1.25));
  var drawP = 0.22 + 0.06 * (1 - Math.abs(raw - 0.5) * 2);
  var pA = Math.round(raw * (1 - drawP) * 100);
  var pD = Math.round(drawP * 100);
  var pB = 100 - pA - pD;
  return { a: pA, d: pD, b: pB };
}

// Dev-only decimal Match-Winner odds derived from the implied percents (~fair, >1), so the
// Coins betting screen is usable locally without the worker/API-Football. A ~5% overround
// keeps them looking like a real book. In prod these come from the worker (Pinnacle-first).
function oddsFor(prob) {
  var dec = function (pct) { return Math.round((100 / (Math.max(pct, 1) * 1.05)) * 100) / 100; };
  return { home: dec(prob.a), draw: dec(prob.d), away: dec(prob.b), book: "Pinnacle" };
}

let fid = 0;
const fixtures = [];
Object.keys(GROUPS).forEach(function (g) {
  var codes = GROUPS[g].map(function (t) { return t[1]; });
  RR.forEach(function (round, mdIdx) {
    round.forEach(function (pair, slot) {
      var a = codes[pair[0]], b = codes[pair[1]];
      var ko = new Date(mdDate(g, mdIdx) + "T" + SLOTS[slot] + ":00Z");
      var venue = VENUES[(fid * 7) % VENUES.length];
      var f = {
        id: "m" + (fid++),
        group: g, matchday: mdIdx + 1,
        t1: a, t2: b,
        ko: ko, venue: venue[0], city: venue[1],
        status: "upcoming", score: null, minute: null,
        prob: probFor(a, b), odds: oddsFor(probFor(a, b))
      };
      fixtures.push(f);
    });
  });
});

// ---- statuses by Sydney calendar day ----
// Sydney is UTC+10: 13 Jun 00:00 AEST = 12 Jun 14:00Z; 14 Jun 00:00 AEST = 13 Jun 14:00Z
const DAY_START = new Date("2026-06-12T14:00:00Z");
const DAY_END   = new Date("2026-06-13T14:00:00Z");

function find(g, a, b) {
  return fixtures.filter(function (f) {
    return f.group === g && ((f.t1 === a && f.t2 === b) || (f.t1 === b && f.t2 === a));
  })[0];
}
var derbyMatch = find("L", "hr", "gh");   // Croatia v Ghana — NEXT (upcoming, tonight)
var liveMatch  = find("A", "ar", "mx");   // Argentina v Mexico — LIVE now
var laterMatch = find("H", "es", "ma");   // Spain v Morocco — upcoming tonight

fixtures.forEach(function (f) {
  var today = f.ko >= DAY_START && f.ko < DAY_END;
  if (f === liveMatch)       { f.ko = new Date("2026-06-13T06:30:00Z"); f.status = "live"; f.minute = 63; f.score = [2, 0]; return; }
  if (f === derbyMatch)      { f.ko = new Date("2026-06-13T09:00:00Z"); f.status = "upcoming"; return; }
  if (f === laterMatch)      { f.ko = new Date("2026-06-13T11:30:00Z"); f.status = "upcoming"; return; }
  if (f.ko < DAY_START)      { f.status = "final"; f.score = scoreFor(f.t1, f.t2, rand); return; }
  if (today && f.ko.getUTCHours() < 6) { f.status = "final"; f.score = scoreFor(f.t1, f.t2, rand); return; }
  f.status = "upcoming";
});

// ---- compute standings from finished results ----
Object.keys(teams).forEach(function (c) {
  var t = teams[c]; t.win = t.draw = t.loss = t.gf = t.ga = t.pts = t.played = 0;
});
fixtures.forEach(function (f) {
  if (f.status !== "final" && !(f.status === "live")) return;
  // only count finals toward table (live not counted)
  if (f.status !== "final") return;
  var A = team(f.t1), B = team(f.t2), s = f.score;
  A.played++; B.played++; A.gf += s[0]; A.ga += s[1]; B.gf += s[1]; B.ga += s[0];
  if (s[0] > s[1]) { A.win++; A.pts += 3; B.loss++; }
  else if (s[0] < s[1]) { B.win++; B.pts += 3; A.loss++; }
  else { A.draw++; B.draw++; A.pts++; B.pts++; }
});
const standings = {};
Object.keys(GROUPS).forEach(function (g) {
  standings[g] = GROUPS[g].map(function (t) { return teams[t[1]]; }).slice().sort(function (x, y) {
    return (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf) || x.name.localeCompare(y.name);
  });
});

// ---- derbies (two members own opposite teams in a fixture) ----
fixtures.forEach(function (f) {
  var o1 = ownersOf(f.t1), o2 = ownersOf(f.t2);
  if (o1.length && o2.length) {
    f.derby = true;
    // double-owner: someone owns both
    f.doubleOwners = o1.filter(function (p) { return o2.indexOf(p) >= 0; });
  } else {
    f.derby = false; f.doubleOwners = [];
  }
});

// sort fixtures chronologically
fixtures.sort(function (a, b) { return a.ko - b.ko; });

// ---- photos (approved + pending for admin queue) ----
// Photos tag a game (fixture), not a team. Each seed photo derives its fixture
// from a match involving the team it was shot for.
const photoSeeds = [
  { id:"ph1", uploader:"Leonard Cherednikov", team:"hr", caption:"Watch party at the Cherednikovs'", status:"approved", ago:"2h" },
  { id:"ph2", uploader:"Sofia", team:"ar", caption:"Kids in their Argentina kits", status:"approved", ago:"5h" },
  { id:"ph3", uploader:"Tom", team:"es", caption:"Pub corner, full Spain gear", status:"approved", ago:"1d" },
  { id:"ph4", uploader:"Jax", team:"gh", caption:"Ghana flag on the balcony", status:"approved", ago:"1d" },
  { id:"ph5", uploader:"Nina", team:"es", caption:"Face paint ready for kickoff", status:"approved", ago:"2d" },
  { id:"ph6", uploader:"Marco", team:"ma", caption:"Morocco scarf, Houston bound", status:"pending", ago:"22m" },
  { id:"ph7", uploader:"Priya", team:"hr", caption:"Checkerboard cupcakes 🧁", status:"pending", ago:"40m" },
  { id:"ph8", uploader:"Diego", team:"br", caption:"Samba drums in the lounge", status:"pending", ago:"1h" }
];
const photos = photoSeeds.map((p) => ({
  ...p,
  fixtureId: (fixtures.find((f) => f.t1 === p.team || f.t2 === p.team) || fixtures[0]).id,
}));

export function generate() {
  return {
    teams,
    teamList: Object.keys(teams).map((c) => teams[c]),
    groups: Object.keys(GROUPS),
    people,
    fixtures,
    standings,
    photos,
    scoring: { id: 1, rule: 'top3', coOwners: 'all_win' },
  };
}
