const clientId = "0ef85cdf0e3744888420f10e413dc758"; // Replace this with your Client ID
const redirectUri = "https://kosmosaik.github.io/random-playlist-generator/";
const scopes = "playlist-modify-public playlist-modify-private";

function login() {
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
  window.location.href = authUrl;
}

document.getElementById("loginBtn").addEventListener("click", login);

const token = new URLSearchParams(window.location.hash.substring(1)).get("access_token");

if (token) {
  document.getElementById("loginBtn").style.display = "none";
  document.getElementById("controls").style.display = "block";
}

document.getElementById("generateBtn").addEventListener("click", async () => {
  const genre = document.getElementById("genre").value;
  const yearFrom = parseInt(document.getElementById("yearFrom").value);
  const yearTo = parseInt(document.getElementById("yearTo").value);
  const size = parseInt(document.getElementById("size").value);
  const minPopularity = parseInt(document.getElementById("popularity").value);

  const meRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: "Bearer " + token }
  });
  const me = await meRes.json();

  const uris = [];
  while (uris.length < size) {
    const year = Math.floor(Math.random() * (yearTo - yearFrom + 1)) + yearFrom;
    const res = await fetch(
      `https://api.spotify.com/v1/recommendations?seed_genres=${genre}&limit=100&min_popularity=${minPopularity}&target_year=${year}`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const data = await res.json();
    uris.push(...data.tracks.map(t => t.uri));
  }

  const playlistRes = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `${genre} ${yearFrom}-${yearTo} Mix`,
      public: false
    })
  });
  const playlist = await playlistRes.json();

  for (let i = 0; i < uris.length; i += 100) {
    await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ uris: uris.slice(i, i + 100) })
    });
  }

  alert("✅ Playlist created!");
  window.open(playlist.external_urls.spotify, "_blank");
});
