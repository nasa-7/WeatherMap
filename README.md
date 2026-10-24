# WeatherMap SPA

A single-page web app: type a city, the map flies to it, and a popup shows live weather. Built with plain HTML, CSS and JavaScript (no frameworks, no jQuery).

## Features
- Search any location and see current weather on an interactive map (Leaflet)
- Info popup: city, temperature, weather icon, clouds, humidity, wind, **Share Weather** and **Save** buttons
- 5-day forecast panel
- Favorite cities, remembered between visits (`localStorage`)
- Map / Satellite layer switch
- AI weather chatbot (OpenAI if a key is set, built-in answers otherwise)
- Loading spinner and friendly error messages

## Setup
1. Get a free key at https://openweathermap.org/api and paste it into `config.js` (`OWM_API_KEY`).
   - Without a key the app runs in demo mode using Open-Meteo (no key needed).
2. *(Optional)* Put an OpenAI key (starts with `sk-`) in `OPENAI_API_KEY` for the AI chatbot.
3. Run it from a local server, **not** by double-clicking the file:
   - VS Code: install **Live Server**, right-click `index.html`, **Open with Live Server**; or
   - Terminal: `python -m http.server 8000` in this folder, then open http://localhost:8000
4. Type a city (e.g. `Port Sudan`) and press **Get Weather**.

## Files
| File | Purpose |
|---|---|
| `index.html` | Page structure (header, map, side panels, chatbot) |
| `style.css` | All visual design and layout |
| `app.js` | All behaviour: search, API calls, map, popup, forecast, favorites, chatbot |
| `config.js` | API keys and default map settings |
| `ARCHITECTURE.md` | How the pieces fit together |

## Services used
Leaflet (map library), Esri / OpenStreetMap tiles (map images), Nominatim (city name to coordinates), OpenWeatherMap (weather), Open-Meteo (keyless fallback), OpenAI (optional chatbot).

## Notes
- API keys in browser code are visible to anyone who opens the page. Fine for coursework; never publish real keys.
- If the OpenWeatherMap icon images are blocked on your network, emoji icons are shown instead.
