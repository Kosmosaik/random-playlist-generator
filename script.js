// ==============================
// Nu Metal Discovery Engine v3.1
//  - PKCE auth
//  - Related-artist crawling
//  - Year + popularity filters
//  - Live progress overlay
// ==============================

window.onerror = (msg) => showStatus("⚠️ JS Error: " + msg, true);

const CLIENT_ID = "0ef85cdf0e3744888420f10e413dc758";
const REDIRECT_URI = "https://kosmosaik.github.io/random-playlist-generator/";
const SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-private",
  "user-read-private",
];

const seedArtists = [
  "12 Stones",
  "3rd Strike",
  "40 Below Summer",
  "(Hed) P.E.",
  "Reveille",
];

// ---------- UI status overlay ----------
function showStatus(msg, append = false) {
  let box = document.getElementById("statusBox");
  let text = document.getElementById("statusText");
  if (!box) {
    box = document.createElement("div");
    box.id = "statusBox";
    box.style = `
      display:block;
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.85);
      color:#0f0;
      font-family:monospace;
      font-size:15px;
      padding:20px;
      overflow-y:auto;
      white-space:pre-wrap;
      z-index:9999;
    `;
    text = document.createElement("div");
    text.id = "statusText";
    box.appendChild(text);
    document.body.appendChild(box);
  }
  box.style.display = "block";
  text.textContent = append ? text.textContent + "\n" + msg : msg;
}
function hideStatus() {
  const box = document.getElementById("statusBox");
  if (box) box.style.display = "none";
}

// ---------- PKCE helpers ----------
async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}
function base64url(buf) {
  let s = btoa(String.fromCharCode.apply(null, [...buf]));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function randPick(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
function yearOf(track) {
  const d = track?.album?.release_date || "";
  return parseInt(d.slice(0, 4), 10);
}
function uniq(arr) {
  return [...new Set(arr)];
}

// ---------- PKCE auth flow ----------
async function beginLogin() {
  const verifier = randomString(96);
  const challenge = base64url(await sha256(verifier));
  sessionStorage.setItem("sp_code_verifier", verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
  });
  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}
async function completeLoginIfReturning() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;

  const verifier = sessionStorage.getItem("sp_code_verifier");
  if (!verifier) return null;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;

  const data = await res.json();
  sessionStorage.setItem("sp_access_token", data.access_token);
  sessionStorage.setItem("sp_token_expires", Date.now() + data.expires_in * 1000);
  history.replaceState({}, document.title, REDIRECT_URI);
  return data.access_token;
}
async function getAccessToken() {
  const existing = sessionStorage.getItem("sp_access_token");
  const expires = sessionStorage.getItem("sp_token_expires");
  if (existing && expires && Date.now() < parseInt(expires)) return existing;
  const newTok = await completeLoginIfReturning();
  if (newTok) return newTok;
  await beginLogin();
}

// ---------- Spotify API ----------
async function searchArtistIdByName(token, name) {
  showStatus("🔍 Searching for " + name, true);
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`;
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.artists?.items?.[0]?.id || null;
}
async function getRelatedArtists(token, id) {
  const r = await fetch(`https://api.spotify.com/v1/artists/${id}/related-artists`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) return [];
  const j = await r.json();
  return j?.artists || [];
}
async function getArtistTopTracks(token, id) {
  const r = await fetch(`https://api.spotify.com/v1/artists/${id}/top-tracks?market=from_token`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) return [];
  const j = await r.json();
  return j?.tracks || [];
}

// ---------- Crawl helpers ----------
async function collectTracksFromArtist(token, artistId, opts) {
  const tracks = await getArtistTopTracks(token, artistId);
  const picked = [];
  const shuffled = randPick(tracks, tracks.length);
  for (const t of shuffled) {
    if (picked.length >= 2) break;
    const y = yearOf(t);
    const pop = t.popularity ?? 0;
    if (y >= opts.yearFrom && y <= opts.yearTo && pop >= opts.minPop && pop <= opts.maxPop) {
      const uri = t.uri;
      if (!opts.seenTrackUris.has(uri)) {
        opts.seenTrackUris.add(uri);
        picked.push(uri);
      }
    }
  }
  return picked;
}
async function crawlFromSeed(token, seedName, opts) {
  const uris = [];
  const seedId = await searchArtistIdByName(token, seedName);
  if (!seedId) return uris;
  let currentId = seedId;
  let loops = 0;
  while (uris.length < opts.need && loops < 50) {
    loops++;
    const related = await getRelatedArtists(token, currentId);
    if (!related.length) break;
    const picks = randPick(related, Math.floor(Math.random() * 2) + 2);
    showStatus(`🎸 From ${seedName}: exploring ${picks.length} related artists…`, true);
    for (const a of picks) {
      if (uris.length >= opts.need) break;
      opts.seenArtistIds.add(a.id);
      const got = await collectTracksFromArtist(token, a.id, opts);
      showStatus(`   ↳ ${a.name}: +${got.length} tracks`, true);
      uris.push(...got);
    }
    if (uris.length >= opts.need) break;
    if (picks.length) currentId = picks[Math.floor(Math.random() * picks.length)].id;
    else break;
  }
  return uris;
}

// ---------- UI main ----------
document.getElementById("loginBtn").addEventListener("click", beginLogin);

(async function init() {
  const token = await getAccessToken();
  if (!token) return;
  document.getElementById("loginBtn").style.display = "none";
  document.getElementById("controls").style.display = "block";

  document.getElementById("generateBtn").addEventListener("click", async () => {
    showStatus("🎬 Starting Nu Metal discovery crawl…");

    const size = parseInt(document.getElementById("size")?.value || "50", 10);
    const yearFrom = parseInt(document.getElementById("yearFrom")?.value || "1995", 10);
    const yearTo = parseInt(document.getElementById("yearTo")?.value || "2008", 10);
    const minPop = parseInt(document.getElementById("popularity")?.value || "0", 10);
    const maxPop = parseInt(document.getElementById("popularityMax")?.value || "100", 10);

    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!meRes.ok) return showStatus("⚠️ Failed to get user info.");
    const me = await meRes.json();

    const seenArtistIds = new Set();
    const seenTrackUris = new Set();
    const finalUris = [];
    const seeds = randPick(seedArtists, seedArtists.length);

    let seedIndex = 0;
    while (finalUris.length < size && seedIndex < seeds.length * 3) {
      const seed = seeds[seedIndex % seeds.length];
      showStatus(`🎯 Using seed artist: ${seed}`, true);
      const need = size - finalUris.length;
      const opts = { need, yearFrom, yearTo, minPop, maxPop, seenArtistIds, seenTrackUris };
      const got = await crawlFromSeed(token, seed, opts);
      finalUris.push(...got);
      showStatus(`✅ ${finalUris.length}/${size} tracks so far.`, true);
      seedIndex++;
    }

    if (!finalUris.length) {
      showStatus("😕 No tracks found. Try wider filters or years.");
      return;
    }

    const unique = uniq(finalUris).slice(0, size);
    showStatus(`🎧 Creating playlist with ${unique.length} tracks…`, true);

    const plRes = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Nu Metal Discovery Mix (${yearFrom}–${yearTo})`,
        public: false,
      }),
    });
    if (!plRes.ok) return showStatus("⚠️ Playlist creation failed.");

    const pl = await plRes.json();
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      await fetch(`https://api.spotify.com/v1/playlists/${pl.id}/tracks`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: batch }),
      });
      showStatus(`   → Added ${Math.min(i + 100, unique.length)} / ${unique.length}`, true);
    }

    showStatus("✅ Playlist created!\nOpening Spotify…", true);
    setTimeout(() => {
      hideStatus();
      window.open(pl.external_urls.spotify, "_blank");
    }, 1500);
  });
})();





