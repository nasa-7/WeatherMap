"use strict";

/* =========================================================
  WeatherMap SPA - vanilla JS (no frameworks)
  Map: Leaflet with Esri / OpenStreetMap tiles
  Flow: geocode (Nominatim) -> weather (OpenWeatherMap,
        Open-Meteo fallback) -> fly map -> marker
        -> popup (InfoWindow)
  Extras: 5-day forecast, favorites, chatbot (OpenAI or built-in)
   ========================================================= */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OWM_WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather";
const OWM_FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast";
const METEO_URL = "https://api.open-meteo.com/v1/forecast";
const FAVORITES_KEY = "weathermap:favorites";

const dom = {
  form: document.getElementById("search-form"),
  input: document.getElementById("location-input"),
  button: document.getElementById("get-weather"),
  alerts: document.getElementById("alerts"),
  spinner: document.getElementById("spinner"),
  favList: document.getElementById("favorites-list"),
  favAdd: document.getElementById("fav-add"),
  forecastCity: document.getElementById("forecast-city"),
  forecastList: document.getElementById("forecast-list"),
  forecastEmpty: document.getElementById("forecast-empty"),
  toast: document.getElementById("toast"),
  chatToggle: document.getElementById("chat-toggle"),
  chatPanel: document.getElementById("chat-panel"),
  chatClose: document.getElementById("chat-close"),
  chatLog: document.getElementById("chat-log"),
  chatSuggest: document.getElementById("chat-suggest"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send")
};

let map = null;
let marker = null;
let toastTimer = null;
let lastWeather = null; // { current, days } for the chatbot

/* ---------------- Phase 1: DOM setup & map init ---------------- */

function initMap() {
  map = L.map("map").setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);

  const esriBase = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const streets = L.tileLayer(esriBase + "World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: "Tiles &copy; Esri"
  });
  const satellite = L.tileLayer(esriBase + "World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: "Tiles &copy; Esri"
  });
  // Only works when the page is served from http://localhost (OSM needs a Referer header).
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  });

  streets.addTo(map);
  L.control.layers({ "Map": streets, "Satellite": satellite, "OpenStreetMap": osm }).addTo(map);
}

/* ---------------- Small helpers ---------------- */

// Create an element with optional class and text (textContent => no HTML injection).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setLoading(isLoading) {
  dom.spinner.classList.toggle("hidden", !isLoading);
  dom.button.disabled = isLoading;
}

function showAlert(message) {
  const card = el("div", "alert-card");
  card.appendChild(el("span", "alert-message", message));
  const close = el("button", "alert-close", "\u00D7");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.addEventListener("click", () => card.remove());
  card.appendChild(close);
  dom.alerts.appendChild(card);
}

function clearAlerts() {
  dom.alerts.replaceChildren();
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.add("hidden"), 2500);
}

// fetch wrapper that turns HTTP/network failures into readable errors
async function getJSON(url, notFoundMessage) {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error("Network problem. Please check your internet connection and try again.");
  }
  if (response.status === 401) {
    throw new Error("Invalid OpenWeatherMap API key. Check config.js (new keys can take a while to activate).");
  }
  if (response.status === 404) {
    throw new Error(notFoundMessage || "Requested data was not found.");
  }
  if (response.status === 429) {
    throw new Error("Too many requests. Please wait a moment and try again.");
  }
  if (!response.ok) {
    throw new Error("The server returned an error (" + response.status + "). Please try again later.");
  }
  return response.json();
}

/* ---------------- Phase 2: geocoding ---------------- */

async function geocode(query) {
  const url = NOMINATIM_URL + "?format=json&limit=1&q=" + encodeURIComponent(query);
  const results = await getJSON(url);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("Could not find \"" + query + "\". Check the spelling or try a nearby city.");
  }
  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    label: results[0].display_name,
    name: results[0].display_name.split(",")[0].trim()
  };
}

/* ---------------- Phase 3: OpenWeatherMap ---------------- */

function owmUrl(base, lat, lng) {
  return base + "?lat=" + lat + "&lon=" + lng + "&units=metric&appid=" + encodeURIComponent(CONFIG.OWM_API_KEY);
}

function hasOwmKey() {
  return Boolean(CONFIG.OWM_API_KEY) && !CONFIG.OWM_API_KEY.startsWith("YOUR_");
}

// Group OpenWeatherMap 3-hour entries into one summary per local day.
function owmToDays(forecastData) {
  const offsetMs = forecastData.city.timezone * 1000;
  const groups = new Map();
  forecastData.list.forEach((entry) => {
    const local = new Date(entry.dt * 1000 + offsetMs);
    const key = local.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, { date: local, items: [] });
    groups.get(key).items.push({ hour: local.getUTCHours(), entry: entry });
  });
  return Array.from(groups.values()).slice(0, 5).map((day) => {
    const temps = day.items.map((i) => i.entry.main.temp);
    const noon = day.items.reduce((best, cur) =>
      Math.abs(cur.hour - 12) < Math.abs(best.hour - 12) ? cur : best).entry;
    const w = noon.weather[0];
    return { date: day.date, hi: Math.max(...temps), lo: Math.min(...temps), icon: w.icon, description: w.description, alt: w.main };
  });
}

async function fetchOwm(place) {
  const [current, forecast] = await Promise.all([
    getJSON(owmUrl(OWM_WEATHER_URL, place.lat, place.lng), "No weather data for this location."),
    getJSON(owmUrl(OWM_FORECAST_URL, place.lat, place.lng), "No forecast data for this location.")
  ]);
  return { current: current, days: owmToDays(forecast) };
}

// WMO weather code -> [description, emoji] (used by the Open-Meteo fallback)
function describeWmo(code) {
  if (code === 0) return ["clear sky", "\u2600\uFE0F"];
  if (code <= 2) return ["partly cloudy", "\u26C5"];
  if (code === 3) return ["overcast", "\u2601\uFE0F"];
  if (code === 45 || code === 48) return ["fog", "\uD83C\uDF2B\uFE0F"];
  if (code >= 51 && code <= 57) return ["drizzle", "\uD83C\uDF26\uFE0F"];
  if (code >= 61 && code <= 67) return ["rain", "\uD83C\uDF27\uFE0F"];
  if (code >= 71 && code <= 77) return ["snow", "\u2744\uFE0F"];
  if (code >= 80 && code <= 82) return ["rain showers", "\uD83C\uDF27\uFE0F"];
  if (code >= 85 && code <= 86) return ["snow showers", "\uD83C\uDF28\uFE0F"];
  if (code >= 95) return ["thunderstorm", "\u26C8\uFE0F"];
  return ["unknown", "\u2753"];
}

// Keyless fallback: converts Open-Meteo data into the same shape as OpenWeatherMap's.
async function fetchMeteo(place) {
  const url = METEO_URL + "?latitude=" + place.lat + "&longitude=" + place.lng +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,cloud_cover,wind_speed_10m,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto&wind_speed_unit=ms";
  const d = await getJSON(url, "No weather data for this location.");
  const now = describeWmo(d.current.weather_code);
  const current = {
    name: place.name,
    sys: {},
    weather: [{ main: now[0], description: now[0], icon: now[1] }],
    main: { temp: d.current.temperature_2m, feels_like: d.current.apparent_temperature, humidity: d.current.relative_humidity_2m },
    clouds: { all: d.current.cloud_cover },
    wind: { speed: d.current.wind_speed_10m }
  };
  const days = d.daily.time.map((t, i) => {
    const info = describeWmo(d.daily.weather_code[i]);
    return { date: new Date(t + "T00:00:00Z"), hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i],
             icon: info[1], description: info[0], alt: info[0] };
  });
  return { current: current, days: days };
}

function fetchWeather(place) {
  return hasOwmKey() ? fetchOwm(place) : fetchMeteo(place);
}

/* ---------------- Phase 4: center map + marker ---------------- */

function placeMarker(lat, lng) {
  map.flyTo([lat, lng], CONFIG.CITY_ZOOM, { duration: 1.6 });
  if (marker) {
    map.removeLayer(marker); // clear the previous marker
  }
  marker = L.marker([lat, lng]).addTo(map);
  return marker;
}

/* ---------------- Phase 5: InfoWindow content ---------------- */

function iconUrl(code) {
  return "https://openweathermap.org/img/wn/" + code + "@2x.png";
}

// Emoji stand-ins for OpenWeatherMap icon codes (used when the icon image cannot load).
function owmEmoji(code) {
  const night = code.endsWith("n");
  const map = { "01": night ? "\uD83C\uDF19" : "\u2600\uFE0F", "02": "\u26C5", "03": "\u2601\uFE0F", "04": "\u2601\uFE0F",
    "09": "\uD83C\uDF27\uFE0F", "10": "\uD83C\uDF26\uFE0F", "11": "\u26C8\uFE0F", "13": "\u2744\uFE0F", "50": "\uD83C\uDF2B\uFE0F" };
  return map[code.slice(0, 2)] || "\uD83C\uDF21\uFE0F";
}

function emojiIcon(emoji, className, alt) {
  const span = el("span", className + " emoji-icon", emoji);
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", alt);
  return span;
}

// OpenWeatherMap icon codes (e.g. "10d") become images; anything else is an emoji.
function makeIcon(code, className, alt) {
  if (/^\d{2}[dn]$/.test(code)) {
    const img = el("img", className);
    img.src = iconUrl(code);
    img.alt = alt;
    img.addEventListener("error", () => img.replaceWith(emojiIcon(owmEmoji(code), className, alt)), { once: true });
    return img;
  }
  return emojiIcon(code, className, alt);
}

function buildShareMessage(data) {
  const w = data.weather[0];
  return "Weather in " + data.name + ": " + Math.round(data.main.temp) + "\u00B0C, " + w.description +
    ", humidity " + data.main.humidity + "%, wind " + data.wind.speed + " m/s. (via WeatherMap)";
}

async function shareWeather(data) {
  const text = buildShareMessage(data);
  if (navigator.share) {
    try {
      await navigator.share({ title: "WeatherMap", text: text });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // user closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Weather message copied to clipboard");
  } catch (err) {
    showAlert("Could not copy automatically. Here is the message: " + text);
  }
}

let popupFavRefresh = null;

function buildPopup(data) {
  const w = data.weather[0];
  const card = el("div", "wcard");

  const top = el("div", "wcard-top");
  const place = el("div", "wcard-place");
  place.appendChild(el("h3", "wcard-city", data.name + (data.sys && data.sys.country ? ", " + data.sys.country : "")));
  place.appendChild(el("p", "wcard-desc", w.description));
  top.appendChild(place);
  top.appendChild(makeIcon(w.icon, "wcard-icon", w.main));
  card.appendChild(top);

  card.appendChild(el("div", "wcard-temp", Math.round(data.main.temp) + "\u00B0C"));
  card.appendChild(el("p", "wcard-feels", "Feels like " + Math.round(data.main.feels_like) + "\u00B0C"));

  const stats = el("div", "wcard-stats");
  [["\u2601\uFE0F", "Clouds", data.clouds.all + "%"],
   ["\uD83D\uDCA7", "Humidity", data.main.humidity + "%"],
   ["\uD83D\uDCA8", "Wind", data.wind.speed + " m/s"]].forEach((row) => {
    const stat = el("div", "wcard-stat");
    stat.appendChild(el("span", "", row[0]));
    stat.appendChild(el("strong", "", row[2]));
    stat.appendChild(el("small", "", row[1]));
    stats.appendChild(stat);
  });
  card.appendChild(stats);

  const actions = el("div", "wcard-actions");
  const shareBtn = el("button", "wcard-btn primary", "\u2197 Share Weather");
  shareBtn.type = "button";
  shareBtn.addEventListener("click", () => shareWeather(data));

  const favBtn = el("button", "wcard-btn");
  favBtn.type = "button";
  popupFavRefresh = () => {
    favBtn.textContent = isFavorite(data.name) ? "\u2605 Saved" : "\u2606 Save";
  };
  popupFavRefresh();
  favBtn.addEventListener("click", () => toggleFavorite(data.name));

  actions.appendChild(shareBtn);
  actions.appendChild(favBtn);
  card.appendChild(actions);
  return card;
}

/* ---------------- 5-day forecast (bonus) ---------------- */

function renderForecast(days, cityName) {
  dom.forecastList.replaceChildren();
  days.forEach((day, i) => {
    const row = el("div", "frow");
    row.appendChild(el("div", "frow-day", i === 0 ? "Today" :
      day.date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })));
    row.appendChild(makeIcon(day.icon, "frow-icon", day.alt));
    row.appendChild(el("div", "frow-desc", day.description));
    const temps = el("div", "frow-temps", Math.round(day.hi) + "\u00B0 ");
    temps.appendChild(el("span", "frow-low", Math.round(day.lo) + "\u00B0"));
    row.appendChild(temps);
    dom.forecastList.appendChild(row);
  });
  dom.forecastCity.textContent = cityName;
  dom.forecastEmpty.classList.add("hidden");
}

/* ---------------- Favorites (bonus, localStorage) ---------------- */

function loadFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch (err) {
    return [];
  }
}

function saveFavorites(list) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch (err) {
    showAlert("Could not save favorites in this browser.");
  }
}

function isFavorite(city) {
  return loadFavorites().some((c) => c.toLowerCase() === city.toLowerCase());
}

function toggleFavorite(city) {
  let list = loadFavorites();
  if (isFavorite(city)) {
    list = list.filter((c) => c.toLowerCase() !== city.toLowerCase());
  } else {
    list.push(city);
  }
  saveFavorites(list);
  renderFavorites();
}

function renderFavorites() {
  const list = loadFavorites();
  dom.favList.replaceChildren();
  if (list.length === 0) {
    dom.favList.appendChild(el("span", "favorites-empty", "No saved cities yet. Search one, then tap Save."));
    if (popupFavRefresh) popupFavRefresh();
    return;
  }
  list.forEach((city) => {
    const chip = el("div", "fav-chip");
    const go = el("button", "fav-go", city);
    go.type = "button";
    go.addEventListener("click", () => {
      dom.input.value = city;
      search(city);
    });
    const remove = el("button", "fav-remove", "\u00D7");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + city + " from favorites");
    remove.addEventListener("click", () => toggleFavorite(city));
    chip.appendChild(go);
    chip.appendChild(remove);
    dom.favList.appendChild(chip);
  });
  if (popupFavRefresh) popupFavRefresh();
}

/* ---------------- AI chatbot (bonus) ---------------- */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const chatHistory = [];

function hasOpenAiKey() {
  return Boolean(CONFIG.OPENAI_API_KEY) && !CONFIG.OPENAI_API_KEY.startsWith("YOUR_");
}

function addChatMessage(role, text, extraClass) {
  const msg = el("div", "chat-msg " + role + (extraClass ? " " + extraClass : ""), text);
  dom.chatLog.appendChild(msg);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
  return msg;
}

function weatherContext() {
  if (!lastWeather) return "No city has been searched yet.";
  const c = lastWeather.current;
  const w = c.weather[0];
  const forecast = lastWeather.days.map((d) =>
    d.date.toISOString().slice(0, 10) + ": " + Math.round(d.lo) + "-" + Math.round(d.hi) + "\u00B0C, " + d.description).join("; ");
  return "Current weather in " + c.name + ": " + Math.round(c.main.temp) + "\u00B0C (feels " +
    Math.round(c.main.feels_like) + "\u00B0C), " + w.description + ", humidity " + c.main.humidity +
    "%, wind " + c.wind.speed + " m/s, clouds " + c.clouds.all + "%. 5-day forecast: " + forecast + ".";
}

// Simple rule-based answers used when no OpenAI key is configured.
function localReply(question) {
  if (!lastWeather) return "Search for a city first, then ask me about its weather.";
  const q = question.toLowerCase();
  const c = lastWeather.current;
  const desc = c.weather[0].description;
  const temp = Math.round(c.main.temp);
  const wet = /rain|drizzle|shower|thunder|storm/;
  if (/umbrella|rain/.test(q)) {
    const rainDay = lastWeather.days.find((d) => wet.test(d.description));
    if (wet.test(desc)) return "Yes, it is " + desc + " in " + c.name + " right now. Take an umbrella.";
    return rainDay ? "Not right now, but rain is expected on " + rainDay.date.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" }) + "."
                   : "No rain is expected in " + c.name + " over the next 5 days.";
  }
  if (/wear|jacket|coat|cloth/.test(q)) {
    if (temp >= 30) return "It is " + temp + "\u00B0C. Light, breathable clothes and water are a good idea.";
    if (temp >= 18) return "It is " + temp + "\u00B0C. A t-shirt is fine; maybe a light layer for the evening.";
    return "It is " + temp + "\u00B0C. Wear a jacket.";
  }
  if (/forecast|week|tomorrow|days|next/.test(q)) {
    return lastWeather.days.map((d) => d.date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }) +
      ": " + Math.round(d.lo) + "-" + Math.round(d.hi) + "\u00B0C, " + d.description).join("\n");
  }
  if (/wind/.test(q)) return "Wind in " + c.name + " is " + c.wind.speed + " m/s.";
  if (/humid/.test(q)) return "Humidity in " + c.name + " is " + c.main.humidity + "%.";
  if (/cloud/.test(q)) return "Cloud cover in " + c.name + " is " + c.clouds.all + "%.";
  if (/temp|hot|cold|warm|degree/.test(q)) return "It is " + temp + "\u00B0C in " + c.name + " (feels like " + Math.round(c.main.feels_like) + "\u00B0C).";
  return "In " + c.name + " it is " + temp + "\u00B0C with " + desc + ". Ask me about rain, wind, humidity, clothes or the forecast.";
}

async function openAiReply(question) {
  const messages = [
    { role: "system", content: "You are a concise weather assistant inside a map app. Use this data when relevant. " + weatherContext() }
  ].concat(chatHistory.slice(-8), [{ role: "user", content: question }]);
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + CONFIG.OPENAI_API_KEY.trim() },
      body: JSON.stringify({ model: CONFIG.OPENAI_MODEL, messages: messages, max_tokens: 300 })
    });
  } catch (err) {
    throw new Error("Could not reach the AI service. Check your connection.");
  }
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).error.message; } catch (err) { /* no JSON body */ }
    throw new Error("OpenAI error " + response.status + ": " + (detail || "request failed"));
  }
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

function showTyping() {
  const msg = el("div", "chat-msg bot typing");
  for (let i = 0; i < 3; i++) msg.appendChild(el("span", "dot"));
  dom.chatLog.appendChild(msg);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
  return msg;
}

async function askChat(question) {
  addChatMessage("user", question);
  dom.chatSend.disabled = true;
  const typing = showTyping();
  try {
    const answer = hasOpenAiKey() ? await openAiReply(question) : (await new Promise((r) => setTimeout(r, 500)), localReply(question));
    typing.remove();
    addChatMessage("bot", answer);
    chatHistory.push({ role: "user", content: question }, { role: "assistant", content: answer });
  } catch (err) {
    typing.remove();
    addChatMessage("bot", err.message + "\n(Switching to basic answers.)");
    addChatMessage("bot", localReply(question));
  } finally {
    dom.chatSend.disabled = false;
  }
}

function handleChatSubmit(event) {
  event.preventDefault();
  const question = dom.chatInput.value.trim();
  if (!question) return;
  dom.chatInput.value = "";
  askChat(question);
}

function initChat() {
  addChatMessage("bot", "Hi! I'm WeatherBot. Search for a city, then ask me about it.");
  ["Do I need an umbrella?", "What should I wear?", "5-day forecast", "How windy is it?"].forEach((q) => {
    const chip = el("button", "chat-chip", q);
    chip.type = "button";
    chip.addEventListener("click", () => askChat(q));
    dom.chatSuggest.appendChild(chip);
  });
  dom.chatToggle.addEventListener("click", () => {
    dom.chatPanel.classList.toggle("hidden");
    if (!dom.chatPanel.classList.contains("hidden")) dom.chatInput.focus();
  });
  dom.chatClose.addEventListener("click", () => dom.chatPanel.classList.add("hidden"));
  dom.chatForm.addEventListener("submit", handleChatSubmit);
}

/* ---------------- Orchestration ---------------- */

async function search(query) {
  clearAlerts();
  setLoading(true);
  try {
    const place = await geocode(query);                         // Phase 2
    const { current, days } = await fetchWeather(place);        // Phase 3
    const m = placeMarker(place.lat, place.lng);                // Phase 4
    m.bindPopup(buildPopup(current), { className: "weather-popup", maxWidth: 290 }); // Phase 5
    m.openPopup();
    lastWeather = { current: current, days: days };
    renderForecast(days, current.name);
    if (!hasOwmKey()) showToast("Demo mode: using Open-Meteo (no OpenWeatherMap key set)");
  } catch (err) {
    showAlert(err.message || "Something went wrong. Please try again.");
  } finally {
    setLoading(false);
  }
}

dom.form.addEventListener("submit", (event) => {
  event.preventDefault(); // no full-page reload
  const query = dom.input.value.trim();
  if (!query) {
    showAlert("Please type a location first.");
    return;
  }
  search(query);
});

dom.favAdd.addEventListener("click", () => {
  if (!lastWeather) {
    showToast("Search for a city first");
    return;
  }
  toggleFavorite(lastWeather.current.name);
});

initMap();
renderFavorites();
initChat();
