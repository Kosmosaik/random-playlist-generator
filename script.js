// ==============================
// Spotify Random Playlist Maker
// Authorization Code Flow (PKCE)
// ==============================
window.onerror = (msg, src, line, col, err) => alert("⚠️ JS Error: " + msg);

const CLIENT_ID = "0ef85cdf0e3744888420f10e413dc758";
const REDIRECT_URI = "https://kosmosaik.github.io/random-playlist-generator/";
const SCOPES = ["playlist-modify-public", "playlist-modify-private"];

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
  history.replaceState({}, document.title, REDIRECT_URI); // Clean up ?code= from URL
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

  document.getElementById("generateBtn").addEventListener("click", async () => {
    const genre = document.getElementById("genre").value;
    const yearFrom = parseInt(document.getElementById("yearFrom").value);
    const yearTo = parseInt(document.getElementById("yearTo").value);
    const size = parseInt(document.getElementById("size").value);
    const minPopularity = parseInt(document.getElementById("popularity").value);

    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: "Bearer " + token },
    });
    const me = await meRes.json();

    const uris = [];
    while (uris.length < size) {
      const year = Math.floor(Math.random() * (yearTo - yearFrom + 1)) + yearFrom;
      const res = await fetch(
        `https://api.spotify.com/v1/recommendations?seed_genres=${genre}&limit=100&min_popularity=${minPopularity}`,
        { headers: { Authorization: "Bearer " + token } }
      );
      const data = await res.json();
      uris.push(...data.tracks.map((t) => t.uri));
    }

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

    alert("✅ Playlist created!");
    window.open(playlist.external_urls.spotify, "_blank");
  });
})();

