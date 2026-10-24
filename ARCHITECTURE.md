# Architecture Overview

## 1. What kind of app is this?
A **Single Page Application (SPA)**: `index.html` loads once, and every search updates the page with JavaScript (`fetch`) without reloading. There is no backend; the browser talks directly to public APIs.

## 2. Structure
```
index.html   -> WHAT is on the page (structure)
style.css    -> HOW it looks (design)
config.js    -> SETTINGS (API keys, default map position)
app.js       -> WHAT HAPPENS (all logic)
```
`config.js` loads before `app.js`, so `app.js` can read the `CONFIG` object.

## 3. External services
| Service | Role | Key needed |
|---|---|---|
| Leaflet | Map library (zoom, pan, markers, popups) | No |
| Esri / OSM tiles | The map images | No |
| Nominatim | Geocoding: city name -> latitude/longitude | No |
| OpenWeatherMap | Current weather + 5-day forecast | Yes |
| Open-Meteo | Keyless fallback if no OpenWeatherMap key | No |
| OpenAI | Optional chatbot answers | Yes (optional) |

## 4. Workflow (the five required phases)
```
User types city -> clicks "Get Weather"
        |
 [submit handler]  preventDefault() -> no page reload
        |
 Phase 2: geocode(query)        Nominatim  -> { lat, lng, name }
        |
 Phase 3: fetchWeather(place)   OpenWeatherMap (or Open-Meteo)
        |                       -> current weather + 5-day list
 Phase 4: placeMarker()         flyTo animation, remove old marker, add new
        |
 Phase 5: buildPopup() + openPopup()   popup with Share / Save
        |
 renderForecast()  fills the side panel
 lastWeather = {...}  remembered for the chatbot
```
Phase 1 (map setup, centered on Khartoum, zoom 6) happens once at page load in `initMap()`. Each step waits for the previous one with `async/await`, so the weather request only starts after the coordinates are known (a chained request).

## 5. Code map (`app.js`)
| Section | Functions | Role |
|---|---|---|
| Setup | `dom`, `initMap` | Grab page elements; create the map and layer switch |
| Helpers | `el`, `setLoading`, `showAlert`, `showToast`, `getJSON` | Build elements safely, spinner, messages, fetch with clear errors |
| Geocoding | `geocode` | City name -> coordinates |
| Weather data | `fetchOwm`, `fetchMeteo`, `fetchWeather`, `owmToDays`, `describeWmo` | Get data; both sources are converted to the **same shape** so the UI doesn't care which was used |
| Map | `placeMarker` | Animated move + marker management |
| Popup | `buildPopup`, `makeIcon`, `shareWeather` | Weather card, icons (emoji fallback), Share button |
| Forecast | `renderForecast` | 5 daily rows in the side panel |
| Favorites | `loadFavorites`, `saveFavorites`, `toggleFavorite`, `renderFavorites` | Saved cities in `localStorage` |
| Chatbot | `weatherContext`, `localReply`, `openAiReply`, `askChat`, `initChat` | Answers questions about the current city |
| Orchestration | `search`, form `submit` listener | Runs the whole workflow and handles errors |

## 6. Key design decisions
- **Same data shape for both weather sources** keeps the UI code single and simple.
- **Fallbacks everywhere:** no OpenWeatherMap key -> Open-Meteo; icon image blocked -> emoji; no OpenAI key or request fails -> built-in answers.
- **Safe rendering:** text is inserted with `textContent` (via `el()`), never `innerHTML`, so API data can't inject HTML.
- **Error handling:** `getJSON` turns HTTP/network failures (401, 404, 429, offline) into readable messages shown as alert cards; `finally` always stops the spinner.
- **State kept small:** `map`, `marker`, `lastWeather`; favorites live in `localStorage`.

## 7. Course constraints met
Separate HTML/CSS/JS files; no inline `onclick` or `style=`; events via `addEventListener`; vanilla JS only; `preventDefault()` on submit; map is 70vh with border and shadow; spinner and error cards; bonus features: Share, favorites, 5-day forecast, AI chatbot.
