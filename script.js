'use strict';

/* ==========================================================================
   1. CONSTANTES E TRADUÇÕES
   ========================================================================== */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_RESULTS = 10;
// Sem timeout uma API lenta deixaria a tela esperando para sempre
const REQUEST_TIMEOUT_MS = 10000;

// Todo texto da interface fica aqui, para nunca se espalhar pelo código
const TRANSLATIONS = {
  pt: {
    htmlLang: 'pt-BR',
    welcomeTitle: 'E aí, qual é a do tempo hoje? 🌤️',
    welcomeText: 'Busque qualquer cidade do mundo e saiba na hora.',
    searchLabel: 'Nome da cidade',
    searchPlaceholder: 'Busque uma cidade',
    searchButton: 'Buscar',
    emptySearch: 'Digite o nome de uma cidade para buscar.',
    searching: 'Buscando…',
    cityNotFound: 'Nenhuma cidade encontrada. Confira a grafia e tente de novo.',
    networkError: 'Sem conexão com a internet. Verifique a rede e tente novamente.',
    serviceError: 'Não foi possível acessar o serviço de busca. Verifique sua conexão ou tente novamente.',
    forecastError: 'Não foi possível carregar a previsão agora. Tente novamente.',
    retry: 'Tentar novamente',
    resultsTitle: 'Qual dessas cidades?',
    unknownRegion: '–',
    themeToLight: 'Mudar para o tema claro',
    themeToDark: 'Mudar para o tema escuro',
    hourlyTitle: 'Próximas 24 horas',
    dailyTitle: 'Próximos 7 dias',
    locale: 'pt-BR',
    feelsLike: 'Sensação',
    wind: 'Vento',
    humidity: 'Umidade',
    rain: 'Chuva',
    uv: 'Índice UV',
    sunrise: 'Nascer do sol',
    sunset: 'Pôr do sol',
    conditions: {
      clear: 'Céu limpo',
      partly: 'Parcialmente nublado',
      cloudy: 'Nublado',
      fog: 'Neblina',
      rain: 'Chuva',
      snow: 'Neve',
      storm: 'Tempestade'
    }
  },
  fr: {
    htmlLang: 'fr',
    welcomeTitle: 'Alors, il fait quoi dehors ? 🌤️',
    welcomeText: "Cherche n'importe quelle ville du monde et sache tout de suite.",
    searchLabel: 'Nom de la ville',
    searchPlaceholder: 'Cherche une ville',
    searchButton: 'Chercher',
    emptySearch: "Tape le nom d'une ville pour chercher.",
    searching: 'Recherche…',
    cityNotFound: "Aucune ville trouvée. Vérifie l'orthographe et réessaie.",
    networkError: 'Pas de connexion internet. Vérifie ton réseau et réessaie.',
    serviceError: "Impossible de joindre le service de recherche. Vérifie ta connexion ou réessaie.",
    forecastError: 'Impossible de charger la météo pour le moment. Réessaie.',
    retry: 'Réessayer',
    resultsTitle: 'Laquelle de ces villes ?',
    unknownRegion: '–',
    themeToLight: 'Passer au thème clair',
    themeToDark: 'Passer au thème sombre',
    hourlyTitle: 'Prochaines 24 heures',
    dailyTitle: '7 prochains jours',
    locale: 'fr-FR',
    feelsLike: 'Ressenti',
    wind: 'Vent',
    humidity: 'Humidité',
    rain: 'Pluie',
    uv: 'Indice UV',
    sunrise: 'Lever du soleil',
    sunset: 'Coucher du soleil',
    conditions: {
      clear: 'Ciel dégagé',
      partly: 'Partiellement nuageux',
      cloudy: 'Nuageux',
      fog: 'Brouillard',
      rain: 'Pluie',
      snow: 'Neige',
      storm: 'Orage'
    }
  }
};

const STORAGE_LANG_KEY = 'climaview.lang';
const STORAGE_CITY_KEY = 'climaview.city';
const STORAGE_THEME_KEY = 'climaview.theme';

// A API devolve códigos WMO (muitos); agrupamos em poucas categorias para simplificar
function getWeatherCategory(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return null;
}

// Só "céu limpo" muda de emoji à noite; sol à noite não faria sentido
const WEATHER_EMOJIS = {
  clear: { day: '☀️', night: '🌙' },
  partly: { day: '⛅', night: '☁️' },
  cloudy: { day: '☁️', night: '☁️' },
  fog: { day: '🌫️', night: '🌫️' },
  rain: { day: '🌧️', night: '🌧️' },
  snow: { day: '❄️', night: '❄️' },
  storm: { day: '⛈️', night: '⛈️' }
};

/* ==========================================================================
   2. ESTADO
   ========================================================================== */

// null até o usuário escolher; a persistência entra na Fase 6
let currentLang = null;
// 'light' ou 'dark'; definido na inicialização
let currentTheme = 'light';
// O que o botão "Tentar novamente" deve repetir (busca ou previsão)
let retryAction = null;
// Mensagem na tela, guardada como chave de tradução para ser traduzida de novo ao trocar o idioma
let currentMessage = null;
// Cidade e previsão abertas; guardadas para re-renderizar ao trocar de idioma
let currentCity = null;
let currentWeather = null;
// Cada busca recebe um número; respostas de buscas antigas são descartadas
let searchCounter = 0;

/* ==========================================================================
   3. UTILITÁRIOS
   ========================================================================== */

function t(key) {
  return TRANSLATIONS[currentLang][key];
}

// Monta "Cidade, Região, País" pulando partes ausentes
function formatCityName(city) {
  return [city.name, city.admin1, city.country].filter(Boolean).join(', ');
}

/* ==========================================================================
   3b. LOCALSTORAGE
   ========================================================================== */

// Tudo aqui é protegido por try/catch: em modo privado ou com o storage
// bloqueado o acesso lança erro, e o app deve continuar como na primeira visita

function saveLanguage(lang) {
  try {
    localStorage.setItem(STORAGE_LANG_KEY, lang);
  } catch (error) {
    // Sem storage: o app funciona, só não lembra da escolha
  }
}

function loadLanguage() {
  try {
    const lang = localStorage.getItem(STORAGE_LANG_KEY);
    return TRANSLATIONS[lang] ? lang : null;
  } catch (error) {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_THEME_KEY, theme);
  } catch (error) {
    // Sem storage: o tema vale só até fechar a página
  }
}

// Devolve 'light', 'dark' ou null (nunca escolheu ou valor inválido)
function loadTheme() {
  try {
    const theme = localStorage.getItem(STORAGE_THEME_KEY);
    return theme === 'light' || theme === 'dark' ? theme : null;
  } catch (error) {
    return null;
  }
}

// Guardamos só o necessário para reabrir a cidade sem nova busca
function saveCity(city) {
  const data = {
    name: city.name,
    admin1: city.admin1,
    country: city.country,
    latitude: city.latitude,
    longitude: city.longitude
  };
  try {
    localStorage.setItem(STORAGE_CITY_KEY, JSON.stringify(data));
  } catch (error) {
    // Sem storage: ignora
  }
}

// Devolve uma cidade válida ou null; dados corrompidos são descartados
function loadCity() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_CITY_KEY));
    const isValid = data !== null
      && typeof data === 'object'
      && typeof data.name === 'string' && data.name !== ''
      && Number.isFinite(data.latitude) && Math.abs(data.latitude) <= 90
      && Number.isFinite(data.longitude) && Math.abs(data.longitude) <= 180;
    if (!isValid) {
      return null;
    }
    return {
      name: data.name,
      admin1: typeof data.admin1 === 'string' ? data.admin1 : undefined,
      country: typeof data.country === 'string' ? data.country : undefined,
      latitude: data.latitude,
      longitude: data.longitude
    };
  } catch (error) {
    return null;
  }
}

/* ==========================================================================
   4. API
   ========================================================================== */

function createApiError(kind) {
  return Object.assign(new Error('api ' + kind), { kind });
}

// Faz o GET e devolve o JSON. Erros viram exceções com .kind ('network' | 'service')
async function fetchJson(url) {
  const controller = new AbortController();
  // O timeout cobre a conexão E a leitura do corpo; por isso só é limpo no finally externo
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      // fetch também falha quando a API é bloqueada (extensão, antivírus, firewall) com a
      // internet funcionando. Só dizemos "sem conexão" quando o navegador confirma que está offline
      throw createApiError(navigator.onLine === false ? 'network' : 'service');
    }

    if (!response.ok) {
      throw createApiError('service');
    }

    try {
      return await response.json();
    } catch (error) {
      // JSON inválido ou timeout durante a leitura do corpo
      throw createApiError('service');
    }
  } finally {
    clearTimeout(timer);
  }
}

// Devolve a lista de cidades (pode ser vazia)
async function fetchCities(query, lang) {
  const params = new URLSearchParams({
    name: query,
    count: String(MAX_RESULTS),
    language: lang,
    format: 'json'
  });
  const data = await fetchJson(`${GEOCODING_URL}?${params}`);

  // A API omite "results" quando não acha nada
  return Array.isArray(data.results) ? data.results : [];
}

async function fetchWeather(city) {
  const params = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code,is_day',
    // UV não vem em "current", então pegamos a hora correspondente no "hourly"
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,weather_code,is_day,uv_index',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
    wind_speed_unit: 'kmh',
    // Horários vêm no fuso da cidade, não no do computador do usuário
    timezone: 'auto',
    forecast_days: '7'
  });
  const data = await fetchJson(`${FORECAST_URL}?${params}`);

  if (!data || typeof data.current !== 'object' || data.current === null) {
    throw Object.assign(new Error('unexpected response'), { kind: 'service' });
  }
  return data;
}

/* ==========================================================================
   5. RENDERIZAÇÃO
   ========================================================================== */

// Aplica as traduções via textContent/atributos, nunca innerHTML
function renderTranslations() {
  const texts = TRANSLATIONS[currentLang];

  document.documentElement.lang = texts.htmlLang;

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = texts[element.dataset.i18n];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = texts[element.dataset.i18nPlaceholder];
  });
}

function renderLanguageSwitcher() {
  document.querySelectorAll('.language-button').forEach((button) => {
    const isActive = button.dataset.lang === currentLang;
    button.classList.toggle('is-active', isActive);
    // aria-pressed informa a leitores de tela qual idioma está ativo
    button.setAttribute('aria-pressed', String(isActive));
  });
}

// O botão mostra o tema para o qual vai mudar (🌙 no claro, ☀️ no escuro)
function renderThemeButton() {
  const button = document.getElementById('theme-toggle');
  const isDark = currentTheme === 'dark';
  document.getElementById('theme-toggle-icon').textContent = isDark ? '☀️' : '🌙';
  button.setAttribute('aria-pressed', String(isDark));
  if (currentLang) {
    const label = t(isDark ? 'themeToLight' : 'themeToDark');
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

function applyTheme(theme) {
  currentTheme = theme;
  // O CSS troca todas as cores a partir de data-theme no <html>
  document.documentElement.dataset.theme = theme;
  renderThemeButton();
}

function showApp() {
  document.getElementById('language-modal').hidden = true;
  document.getElementById('header-actions').hidden = false;
  document.getElementById('app-main').hidden = false;
}

function clearResults() {
  hideMessage();
  document.getElementById('results').hidden = true;
  document.getElementById('results-list').replaceChildren();
}

// Desenha currentMessage no idioma atual (chamada também ao trocar de idioma)
function renderMessage() {
  const box = document.getElementById('message');
  if (!currentMessage) {
    box.hidden = true;
    return;
  }
  const retryButton = document.getElementById('retry-button');
  document.getElementById('message-text').textContent = t(currentMessage.key);
  box.className = 'message message-' + currentMessage.type;
  retryButton.hidden = !currentMessage.withRetry;
  retryButton.textContent = t('retry');
  box.hidden = false;
}

// key: chave de TRANSLATIONS. type: 'info' | 'error'. withRetry mostra "Tentar novamente"
function showMessage(key, type, withRetry) {
  currentMessage = { key, type, withRetry };
  renderMessage();
}

function hideMessage() {
  currentMessage = null;
  renderMessage();
}

function renderResults(cities) {
  const list = document.getElementById('results-list');
  list.replaceChildren();

  cities.forEach((city) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'city-card';

    const name = document.createElement('span');
    name.className = 'city-card-name';
    name.textContent = city.name;

    const place = document.createElement('span');
    place.className = 'city-card-place';
    place.textContent = [city.admin1, city.country].filter(Boolean).join(', ') || t('unknownRegion');

    button.append(name, place);
    button.addEventListener('click', () => selectCity(city));
    item.append(button);
    list.append(item);
  });

  document.getElementById('results').hidden = false;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

// Campos ausentes na resposta aparecem como "–" em vez de quebrar a tela
function formatValue(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '–';
  }
  // "|| 0" troca -0 por 0, senão valores como -0,04 apareceriam como "-0"
  const rounded = Math.round(value * 10) / 10 || 0;
  // Intl usa a vírgula decimal do idioma: "23,8" em PT e em FR
  const text = new Intl.NumberFormat(t('locale'), { maximumFractionDigits: 1 }).format(rounded);
  return unit ? `${text} ${unit}` : text;
}

// Os horários da API já vêm no fuso da cidade ("2026-11-14T05:41"), então só cortamos o texto
function formatTime(isoString) {
  return typeof isoString === 'string' ? isoString.slice(11, 16) : '–';
}

// Procura o UV da hora cheia atual da cidade (comparando com current.time, não com o relógio local)
function getCurrentUv(weather) {
  const hourly = weather.hourly;
  const currentTime = weather.current.time;
  if (!hourly || !Array.isArray(hourly.time) || typeof currentTime !== 'string') {
    return null;
  }
  const index = hourly.time.indexOf(currentTime.slice(0, 13) + ':00');
  // valueAt protege contra uv_index ausente na resposta; antes isso derrubava a previsão inteira
  return index === -1 ? null : valueAt(hourly.uv_index, index);
}

// Emoji e texto da condição; código desconhecido vira "–" em vez de quebrar
function getWeatherDisplay(code, isDay) {
  const category = getWeatherCategory(code);
  if (!category) {
    return { emoji: '❔', text: '–' };
  }
  const period = isDay === 0 ? 'night' : 'day';
  return { emoji: WEATHER_EMOJIS[category][period], text: t('conditions')[category] };
}

function createEmojiElement(display) {
  const element = createElement('span', 'forecast-emoji', display.emoji);
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', display.text);
  return element;
}

// A data vem como "2026-11-14" (já no dia da cidade). Lemos como UTC para o
// fuso do computador não deslocar o dia
function formatDayLabel(dateString) {
  const date = new Date(dateString + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) {
    return '–';
  }
  return new Intl.DateTimeFormat(t('locale'), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
  }).format(date);
}

function valueAt(list, index) {
  return Array.isArray(list) ? list[index] : undefined;
}

// 24 horas a partir da hora cheia atual da cidade (current.time), não do relógio local
function renderHourlyForecast(weather) {
  const section = document.getElementById('hourly-forecast');
  const list = document.getElementById('hourly-list');
  const hourly = weather.hourly;
  list.replaceChildren();

  const currentTime = weather.current.time;
  const start = hourly && Array.isArray(hourly.time) && typeof currentTime === 'string'
    ? hourly.time.indexOf(currentTime.slice(0, 13) + ':00')
    : -1;

  if (start === -1) {
    section.hidden = true;
    return;
  }

  hourly.time.slice(start, start + 24).forEach((time, offset) => {
    const index = start + offset;
    const card = createElement('li', 'forecast-card');
    // O CSS usa --i para escalonar a animação de entrada
    card.style.setProperty('--i', String(offset));
    card.append(
      createElement('span', 'forecast-label', formatTime(time)),
      createEmojiElement(getWeatherDisplay(valueAt(hourly.weather_code, index), valueAt(hourly.is_day, index))),
      createElement('span', 'forecast-temp', formatValue(valueAt(hourly.temperature_2m, index), '°C')),
      createElement('span', 'forecast-extra', '💧 ' + formatValue(valueAt(hourly.precipitation_probability, index), '%')),
      createElement('span', 'forecast-extra', '💨 ' + formatValue(valueAt(hourly.wind_speed_10m, index), 'km/h'))
    );
    list.append(card);
  });

  section.hidden = false;
}

function renderDailyForecast(weather) {
  const section = document.getElementById('daily-forecast');
  const list = document.getElementById('daily-list');
  const daily = weather.daily;
  list.replaceChildren();

  if (!daily || !Array.isArray(daily.time)) {
    section.hidden = true;
    return;
  }

  daily.time.forEach((date, index) => {
    const card = createElement('li', 'forecast-card');
    card.style.setProperty('--i', String(index));
    const min = formatValue(valueAt(daily.temperature_2m_min, index), '°C');
    const max = formatValue(valueAt(daily.temperature_2m_max, index), '°C');
    card.append(
      createElement('span', 'forecast-label', formatDayLabel(date)),
      createEmojiElement(getWeatherDisplay(valueAt(daily.weather_code, index), 1)),
      createElement('span', 'forecast-temp', `${min} / ${max}`),
      createElement('span', 'forecast-extra', '💧 ' + formatValue(valueAt(daily.precipitation_probability_max, index), '%')),
      createElement('span', 'forecast-extra', '💨 ' + formatValue(valueAt(daily.wind_speed_10m_max, index), 'km/h'))
    );
    list.append(card);
  });

  section.hidden = false;
}

// Sem os atributos, o CSS usa o fundo neutro
function resetBackground() {
  delete document.body.dataset.weather;
  delete document.body.dataset.period;
}

// O CSS escolhe as cores a partir de data-weather e data-period no body
function renderBackground(weather) {
  const category = getWeatherCategory(weather.current.weather_code);
  if (category) {
    document.body.dataset.weather = category;
    document.body.dataset.period = weather.current.is_day === 0 ? 'night' : 'day';
  } else {
    // Código desconhecido: volta ao fundo neutro
    resetBackground();
  }
}

function renderWeather(city, weather) {
  renderBackground(weather);
  renderCurrentWeather(city, weather);
  renderHourlyForecast(weather);
  renderDailyForecast(weather);
}

function hideForecasts() {
  document.getElementById('hourly-forecast').hidden = true;
  document.getElementById('daily-forecast').hidden = true;
}

// Esconde o clima da tela sem apagar os dados (currentCity/currentWeather)
function hideWeather() {
  document.getElementById('current-weather').hidden = true;
  hideForecasts();
}

// Mostra de novo a cidade que estava aberta, se houver; usado quando uma busca nova não dá em nada
function restoreWeather() {
  if (currentCity && currentWeather) {
    renderWeather(currentCity, currentWeather);
  } else {
    // Nenhuma cidade na tela: o fundo de uma cidade anterior não deve ficar
    resetBackground();
  }
}

function renderWeatherSkeleton() {
  const container = document.getElementById('current-weather');
  container.replaceChildren(
    createElement('div', 'skeleton skeleton-title'),
    createElement('div', 'skeleton skeleton-temp'),
    createElement('div', 'skeleton skeleton-grid')
  );
  container.hidden = false;
}

function renderCurrentWeather(city, weather) {
  const container = document.getElementById('current-weather');
  const current = weather.current;
  const display = getWeatherDisplay(current.weather_code, current.is_day);
  const conditionText = display.text;

  const emojiElement = createElement('span', 'current-emoji', display.emoji);
  emojiElement.setAttribute('role', 'img');
  emojiElement.setAttribute('aria-label', conditionText);

  const main = createElement('div', 'current-main');
  main.append(
    emojiElement,
    createElement('span', 'current-temp', formatValue(current.temperature_2m, '°C'))
  );

  const daily = weather.daily || {};
  const details = [
    ['feelsLike', formatValue(current.apparent_temperature, '°C')],
    ['wind', formatValue(current.wind_speed_10m, 'km/h')],
    ['humidity', formatValue(current.relative_humidity_2m, '%')],
    ['rain', formatValue(current.precipitation, 'mm')],
    ['uv', formatValue(getCurrentUv(weather))],
    ['sunrise', formatTime(daily.sunrise && daily.sunrise[0])],
    ['sunset', formatTime(daily.sunset && daily.sunset[0])]
  ];

  const grid = createElement('dl', 'current-details');
  details.forEach(([labelKey, value]) => {
    const item = createElement('div', 'current-detail');
    item.append(createElement('dt', 'current-detail-label', t(labelKey)), createElement('dd', 'current-detail-value', value));
    grid.append(item);
  });

  container.replaceChildren(
    createElement('h2', 'current-city', formatCityName(city)),
    main,
    createElement('p', 'current-condition', conditionText),
    grid
  );
  container.hidden = false;
}

/* ==========================================================================
   6. AÇÕES
   ========================================================================== */

function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) {
    return;
  }
  currentLang = lang;
  saveLanguage(lang);
  renderTranslations();
  renderLanguageSwitcher();
  renderThemeButton();
  // A mensagem na tela (erro, aviso) também muda de idioma
  renderMessage();
  showApp();
  // Com cidade aberta e visível, só os textos mudam; os dados já carregados são reaproveitados.
  // Se ela está escondida (há uma lista de resultados na tela), não a mostramos de volta
  const isWeatherVisible = !document.getElementById('current-weather').hidden;
  if (currentCity && currentWeather && isWeatherVisible) {
    renderWeather(currentCity, currentWeather);
  }
}

async function selectCity(city) {
  const thisSearch = ++searchCounter;
  retryAction = () => selectCity(city);

  clearResults();
  currentCity = null;
  currentWeather = null;
  // A boas-vindas dá lugar à previsão
  document.getElementById('welcome').hidden = true;
  hideForecasts();
  renderWeatherSkeleton();

  try {
    const weather = await fetchWeather(city);
    if (thisSearch !== searchCounter) {
      return;
    }
    currentCity = city;
    currentWeather = weather;
    // Só salva depois que a previsão carregou, para nunca guardar uma cidade que falha
    saveCity(city);
    renderWeather(city, weather);
  } catch (error) {
    if (thisSearch !== searchCounter) {
      return;
    }
    document.getElementById('current-weather').hidden = true;
    // Sem previsão na tela, o fundo da cidade anterior não faz mais sentido
    resetBackground();
    showMessage(error.kind === 'network' ? 'networkError' : 'forecastError', 'error', true);
  }
}

async function searchCity(rawQuery) {
  const query = rawQuery.trim();

  clearResults();

  // Busca vazia não dispara requisição, só avisa
  if (query === '') {
    showMessage('emptySearch', 'info', false);
    return;
  }

  retryAction = () => searchCity(query);
  const thisSearch = ++searchCounter;
  // Esconde o clima aberto, ou um skeleton de uma previsão que acabou de ser descartada
  // (antes ele ficava pulsando para sempre). Os dados ficam guardados para restoreWeather
  hideWeather();
  showMessage('searching', 'info', false);

  try {
    const cities = await fetchCities(query, currentLang);

    // Chegou uma busca mais nova enquanto esta esperava: ignora esta resposta
    if (thisSearch !== searchCounter) {
      return;
    }

    if (cities.length === 0) {
      showMessage('cityNotFound', 'error', false);
      restoreWeather();
    } else if (cities.length === 1) {
      selectCity(cities[0]);
    } else {
      hideMessage();
      renderResults(cities);
    }
  } catch (error) {
    if (thisSearch !== searchCounter) {
      return;
    }
    showMessage(error.kind === 'network' ? 'networkError' : 'serviceError', 'error', true);
    restoreWeather();
  }
}

/* ==========================================================================
   7. EVENTOS
   ========================================================================== */

function bindEvents() {
  // Um único tratamento para os botões do modal e do cabeçalho
  document.querySelectorAll('[data-lang]').forEach((button) => {
    button.addEventListener('click', () => {
      setLanguage(button.dataset.lang);
      // O botão do modal some ao ser clicado e o foco se perderia; levamos para a busca
      if (button.classList.contains('modal-option')) {
        document.getElementById('search-input').focus();
      }
    });
  });

  document.getElementById('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    searchCity(document.getElementById('search-input').value);
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    saveTheme(nextTheme);
  });

  document.getElementById('retry-button').addEventListener('click', () => {
    if (retryAction) {
      retryAction();
    }
  });
}

/* ==========================================================================
   8. INICIALIZAÇÃO
   ========================================================================== */

function init() {
  bindEvents();

  // Sem escolha salva, seguimos o tema do sistema; matchMedia pode faltar em navegadores antigos
  const systemPrefersDark = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(loadTheme() || (systemPrefersDark ? 'dark' : 'light'));

  const savedLang = loadLanguage();
  if (savedLang) {
    // Idioma salvo: sem modal; a última cidade abre com as coordenadas guardadas
    setLanguage(savedLang);
    const savedCity = loadCity();
    if (savedCity) {
      selectCity(savedCity);
    }
    return;
  }

  // Foco no primeiro botão do modal para quem navega só pelo teclado
  document.querySelector('.modal-option').focus();
}

init();
