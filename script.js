// ==============================
// Nu Metal Discovery Engine (Browser-Only)
// - PKCE auth
// - Random related-artist crawling
// - Year & min/max popularity filters
// - Playlist batching & dedupe
// ==============================

/* ---------- Debug (mobile-friendly) ---------- */
window.onerror = (msg, src, line, col, err) => alert("⚠️ JS Error: " + msg);

/* ---------- OAuth (PKCE) ---------- */
const CLIENT_ID = "0ef85cdf0e3744888420f10e413dc758";
const REDIRECT_URI = "https://kosmosaik.github.io/random-playlist-generator/";
const SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-private",
  "user-read-private",
];

/* ---------- Easy-to-edit seed artists ---------- */
const seedArtists = [
  "12 Stones",
  "3rd Strike",
  "40 Below Summer",
  "(Hed) P.E.",
  "Reveille",
];
// Add more later, e.g. "Spineshank", "Flaw", "Adema", "Taproot", ...

/* ---------- Small helpers ---------- */
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
  // pick up to n random distinct items
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

/* ---------- PKCE login flow ---------- */
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

  if (!res.ok) {
    alert("Spotify login failed. Check Redirect URI and Client ID.");
    return null;
  }

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

/* ---------- Spotify API helpers ---------- */
async function searchArtistIdByName(token, name) {
  const endpoint = `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`;
  const r = await fetch(endpoint, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.artists?.items?.[0]?.id || null;
}

async function getRelatedArtists(token, artistId) {
  const endpoint = `https://api.spotify.com/v1/artists/${artistId}/related-artists`;
  const r = await fetch(endpoint, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return [];
  const j = await r.json();
  return j?.artists || [];
}

async function getArtistTopTracks(token, artistId) {
  // market=from_token → uses user's market but is global-friendly
  const endpoint = `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=from_token`;
  const r = await fetch(endpoint, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return [];
  const j = await r.json();
  return j?.tracks || [];
}

/* ---------- Core discovery logic ---------- */
async function collectTracksFromArtist(token, artistId, opts) {
  // opts: { yearFrom, yearTo, minPop, maxPop, need, seenTrackUris }
  const tracks = await getArtistTopTracks(token, artistId);
  if (!tracks.length) return [];

  // randomize a bit first
  const shuffled = randPick(tracks, tracks.length);

  const picked = [];
  for (const t of shuffled) {
    if (picked.length >= 2) break; // 1–2 tracks per artist

    const y = yearOf(t);
    const pop = t.popularity ?? 0;

    if (
      !isNaN(y) &&
      y >= opts.yearFrom &&
      y <= opts.yearTo &&
      pop >= opts.minPop &&
      pop <= opts.maxPop
    ) {
      const uri = t.uri;
      if (!opts.seenTrackUris.has(uri)) {
        picked.push(uri);
        opts.seenTrackUris.add(uri);
      }
    }
  }
  return picked;
}

async function crawlFromSeed(token, seedName, opts) {
  // returns an array of URIs gathered by walking related-artist graph
  // opts: { need, yearFrom, yearTo, minPop, maxPop, seenArtistIds, seenTrackUris }
  const uris = [];

  const seedId = await searchArtistIdByName(token, seedName);
  if (!seedId) return uris;

  let currentId = seedId;
  let safety = 0;

  while (uris.length < opts.need && safety < 50) {
    safety++;

    // 2) related artists of current
    const related = await getRelatedArtists(token, currentId);
    const freshRelated = related.filter(a => !opts.seenArtistIds.has(a.id));

    if (!freshRelated.length) {
      // dead end → break this branch
      break;
    }

    // 3) randomly pick 2–3 bands
    const picks = randPick(freshRelated, Math.floor(Math.random() * 2) + 2); // 2 or 3
    for (const a of picks) {
      if (uris.length >= opts.need) break;
      opts.seenArtistIds.add(a.id);

      // 4) add 1–2 songs from top tracks (filtered)
      const got = await collectTracksFromArtist(token, a.id, opts);
      uris.push(...got);
    }

    if (uris.length >= opts.need) break;

    // 5) go deeper → pick one of the last chosen artists as new current
    if (picks.length) {
      const next = picks[Math.floor(Math.random() * picks.length)];
      currentId = next.id;
    } else {
      break; // no picks → end this branch
    }
  }

  return uris;
}

/* ---------- UI wiring ---------- */
document.getElementById("loginBtn").addEventListener("click", beginLogin);

(async function init() {
  const token = await getAccessToken();
  if (!token) return;

  // show controls
  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn) loginBtn.style.display = "none";
  const controls = document.getElementById("controls");
  if (controls) controls.style.display = "block";

  document.getElementById("generateBtn").addEventListener("click", async () => {
    alert("🎬 Starting Nu Metal discovery crawl…");

    // pull inputs (with safe defaults)
    const size = parseInt(document.getElementById("size")?.value || "50", 10);
    const yearFrom = parseInt(document.getElementById("yearFrom")?.value || "1995", 10);
    const yearTo = parseInt(document.getElementById("yearTo")?.value || "2008", 10);
    const minPop = parseInt(document.getElementById("popularity")?.value || "0", 10);
    const maxPopInput = document.getElementById("popularityMax");
    const maxPop = maxPopInput ? parseInt(maxPopInput.value || "100", 10) : 100;

    if (yearTo < yearFrom) {
      alert("⚠️ Year range is invalid. Make sure 'To' is greater than or equal to 'From'.");
      return;
    }
    if (minPop > maxPop) {
      alert("⚠️ Popularity range is invalid. Min must be ≤ Max.");
      return;
    }

    // Get current user
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!meRes.ok) return alert("⚠️ Failed to get user info: " + meRes.status);
    const me = await meRes.json();

    // Discovery loop
    const seenArtistIds = new Set();
    const seenTrackUris = new Set();
    const finalUris = [];

    // Randomize seed order so we don't always start the same
    const seeds = randPick(seedArtists, seedArtists.length);

    let seedIndex = 0;
    let safeguard = 0;
    while (finalUris.length < size && safeguard < 200) {
      safeguard++;

      // 1) pick one random seed (cycling through randomized order)
      const seedName = seeds[seedIndex % seeds.length];
      seedIndex++;

      const needed = Math.min(size - finalUris.length, 20); // grab in small waves
      const opts = {
        need: needed,
        yearFrom,
        yearTo,
        minPop,
        maxPop,
        seenArtistIds,
        seenTrackUris
      };

      const grabbed = await crawlFromSeed(token, seedName, opts);
      finalUris.push(...grabbed);

      // If this seed barely produced results, try the next one immediately
      if (grabbed.length < 4 && seedIndex < seeds.length) continue;

      // If we exhausted all seeds and still short, reshuffle seeds and go again
      if (seedIndex >= seeds.length && finalUris.length < size) {
        seedIndex = 0;
        // shuffle again to vary order next pass
        seeds.sort(() => 0.5 - Math.random());
      }
    }

    if (!finalUris.length) {
      alert("😕 No tracks found that match your year & popularity filters. Try widening them.");
      return;
    }

    // Dedupe and trim exactly to requested size
    const unique = uniq(finalUris).slice(0, size);

    // Create playlist
    alert(`🎧 Creating playlist with ${unique.length} tracks…`);
    const playlistRes = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Nu Metal Discovery Mix (${yearFrom}–${yearTo})`,
        public: false,
        description: `Auto-generated via related-artist crawl. Popularity ${minPop}–${maxPop}.`
      }),
    });
    if (!playlistRes.ok) {
      const err = await playlistRes.text();
      alert(`⚠️ Playlist creation failed ${playlistRes.status}:\n${err}`);
      return;
    }
    const playlist = await playlistRes.json();

    // Add tracks in batches of 100
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      const addRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: batch }),
      });
      if (!addRes.ok) {
        const err = await addRes.text();
        alert(`⚠️ Failed adding tracks (${addRes.status}):\n${err}`);
        return;
      }
    }

    alert("✅ Playlist created!");
    window.open(playlist.external_urls.spotify, "_blank");
  });
})();




