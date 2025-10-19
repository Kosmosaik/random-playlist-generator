// ==============================
// Spotify Random Playlist Maker (Full Debug + 404 Fix + URL Output)
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

  // ✅ Static list of official Spotify genre seeds
  const seedGenres = [
    "acoustic","afrobeat","alt-rock","alternative","ambient","anime","black-metal","bluegrass",
    "blues","bossanova","brazil","breakbeat","british","cantopop","chicago-house","classical",
    "club","comedy","country","dance","dancehall","death-metal","deep-house","detroit-techno",
    "disco","disney","drum-and-bass","dub","dubstep","edm","electro","electronic","emo","folk",
    "forro","french","funk","garage","german","gospel","goth","grindcore","groove","grunge",
    "guitar","happy","hard-rock","hardcore","hardstyle","heavy-metal","hip-hop","holidays",
    "honky-tonk","house","idm","indian","indie","indie-pop","industrial","iranian","j-dance",
    "j-idol","j-pop","j-rock","jazz","k-pop","kids","latin","latino","malay","mandopop","metal",
    "metalcore","minimal-techno","movies","mpb","new-age","new-release","opera","pagode","party",
    "philippines-opm","piano","pop","pop-film","post-dubstep","power-pop","progressive-house",
    "psych-rock","punk","punk-rock","r-n-b","reggae","reggaeton","rock","rock-n-roll","rockabilly",
    "romance","sad","salsa","samba","sertanejo","show-tunes","singer-songwriter","ska","sleep",
    "songwriter","soul","soundtracks","spanish","study","swedish","synth-pop","tango","techno",
    "trance","trip-hop","turkish","work-out","world-music"
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

  // 🎬 Playlist generator logic
  document.getElementById("generateBtn").addEventListener("click", async () => {
    alert("🎬 Step 1: Button clicked");

    const genre = document.getElementById("genre").value;
    const yearFrom = parseInt(document.getElementById("yearFrom").value);
    const yearTo = parseInt(document.getElementById("yearTo").value);
    const size = parseInt(document.getElementById("size").value);
    const minPopularity = parseInt(document.getElementById("popularity").value);

    alert("🎬 Step 2: Inputs OK, fetching profile...");

    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!meRes.ok) return alert("⚠️ Failed to get user info: " + meRes.status);
    const me = await meRes.json();
    alert("🎬 Step 3: Logged in as " + me.display_name);

    const uris = [];
    for (let tries = 0; uris.length < size && tries < 5; tries++) {
      const year = Math.floor(Math.random() * (yearTo - yearFrom + 1)) + yearFrom;

      const seedGenre = (genre || "metal").trim().toLowerCase();
      const endpoint = `https://api.spotify.com/v1/recommendations?limit=100&market=US&seed_genres=${seedGenre}&min_popularity=${minPopularity}`;

      alert("🎬 Step 4: Requesting recommendations for " + seedGenre);

      const res = await fetch(endpoint, {
        headers: { Authorization: "Bearer " + token },
      });

      if (!res.ok) {
        let errText = "";
        try {
          errText = await res.text();
        } catch (e) {
          errText = "(no error body)";
        }
        alert(`⚠️ Fetch error ${res.status}\n\nURL:\n${endpoint}\n\nResponse:\n${errText}`);
        return;
      }

      const data = await res.json();
      alert("🎬 Step 5: Got " + data.tracks.length + " tracks for " + seedGenre);
      uris.push(...data.tracks.map((t) => t.uri));
    }

    if (uris.length === 0)
      return alert("⚠️ No tracks found for genre '" + genre + "'. Try a different one.");

    alert("🎬 Step 6: Creating playlist...");

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
    if (!playlistRes.ok) {
      const err = await playlistRes.text();
      alert(`⚠️ Playlist creation failed ${playlistRes.status}:\n${err}`);
      return;
    }
    const playlist = await playlistRes.json();

    alert("🎬 Step 7: Adding " + uris.length + " tracks...");

    for (let i = 0; i < uris.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
      });
    }

    alert("✅ Step 8: Playlist created!");
    window.open(playlist.external_urls.spotify, "_blank");
  });
})();

