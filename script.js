// ==============================
// Spotify Random Playlist Maker (Browser-Only, /search API + Subgenres + Fallback)
// Authorization Code Flow (PKCE)
// ==============================
window.onerror = (msg, src, line, col, err) => alert("⚠️ JS Error: " + msg);

const CLIENT_ID = "0ef85cdf0e3744888420f10e413dc758";
const REDIRECT_URI = "https://kosmosaik.github.io/random-playlist-generator/";
const SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-private",
  "user-read-private",
];

// === PKCE UTILITIES ===
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

// === LOGIN FLOW ===
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

// === MAIN APP LOGIC ===
document.getElementById("loginBtn").addEventListener("click", beginLogin);

(async function init() {
  const token = await getAccessToken();
  if (!token) return;

  document.getElementById("loginBtn").style.display = "none";
  document.getElementById("controls").style.display = "block";

  // ✅ Main genres + subgenres
  const seedGenres = [
    // 🎸 Rock / Metal
    "metal","heavy metal","nu metal","death metal","black metal","thrash metal","symphonic metal",
    "doom metal","progressive metal","power metal","folk metal","industrial metal","hard rock",
    "classic rock","punk","punk rock","post rock","grunge","garage rock","psychedelic rock",
    "alternative rock","emo","pop punk","stoner rock",

    // 🎧 Electronic / EDM
    "edm","electro","techno","house","deep house","progressive house","dubstep","trance",
    "drum and bass","ambient","synthwave","hardstyle","dance","electronic","downtempo",

    // 🎤 Pop / Hip-Hop
    "pop","indie pop","synth pop","dream pop","hip-hop","rap","trap","boom bap","r-n-b",
    "funk","soul","disco","dance pop",

    // 🌍 World / Others
    "latin","reggaeton","bossa nova","jazz","blues","folk","country","classical",
    "soundtrack","video game music","anime","lofi","instrumental"
  ];

  // 🎵 Populate dropdown
  const genreSelect = document.getElementById("genre");
  genreSelect.innerHTML = "";
  seedGenres.sort().forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g.charAt(0).toUpperCase() + g.slice(1);
    genreSelect.appendChild(opt);
  });

  // 🎬 Playlist generator logic (using SEARCH)
  document.getElementById("generateBtn").addEventListener("click", async () => {
    alert("🎬 Step 1: Searching Spotify...");

    const genre = document.getElementById("genre").value;
    const yearFrom = parseInt(document.getElementById("yearFrom").value);
    const yearTo = parseInt(document.getElementById("yearTo").value);
    const size = parseInt(document.getElementById("size").value);
    const minPopularity = parseInt(document.getElementById("popularity").value);

    // Get user info
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: "Bearer " + token },
    });
    const me = await meRes.json();

    async function searchTracks(searchGenre) {
      const uris = [];
      let offset = 0;
      while (uris.length < size && offset < 1000) {
        const query = `genre:"${searchGenre}" year:${yearFrom}-${yearTo}`;
        const endpoint = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=50&offset=${offset}`;
        const res = await fetch(endpoint, {
          headers: { Authorization: "Bearer " + token },
        });

        if (!res.ok) break;
        const data = await res.json();
        if (!data.tracks?.items?.length) break;

        const filtered = data.tracks.items.filter((t) => t.popularity >= minPopularity);
        filtered.forEach((t) => uris.push(t.uri));
        offset += 50;
      }
      return uris;
    }

    let uris = await searchTracks(genre);
    if (uris.length === 0 && genre.includes(" ")) {
      // Auto fallback for subgenres
      const broad = genre.split(" ").pop(); // e.g. "nu metal" -> "metal"
      alert(`⚠️ No results for "${genre}", trying broader "${broad}" instead...`);
      uris = await searchTracks(broad);
    }

    if (uris.length === 0) {
      alert("⚠️ No tracks found for that genre/year range. Try another.");
      return;
    }

    // Randomize & trim
    const shuffled = uris.sort(() => 0.5 - Math.random()).slice(0, size);

    // Create playlist
    alert("🎬 Step 2: Creating playlist...");
    const playlistRes = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `${genre} ${yearFrom}-${yearTo} Mix`,
        public: false,
      }),
    });
    const playlist = await playlistRes.json();

    // Add tracks
    alert("🎬 Step 3: Adding songs...");
    for (let i = 0; i < shuffled.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: shuffled.slice(i, i + 100) }),
      });
    }

    alert("✅ Playlist created successfully!");
    window.open(playlist.external_urls.spotify, "_blank");
  });
})();



