# Web Variable & State Discovery Techniques for WDK

Research spike: programmatic discovery of data, state, and variables in unfamiliar web applications from within the browser. All techniques are zero-dependency, bookmarklet-safe JavaScript.

---

## 1. Global Variable Discovery

**What:** Web apps leak state onto `window`. Framework hydration data, stores, config objects, and debug globals all live here.

**Diff technique:** Snapshot `window` property names on a blank `about:blank` page to get the browser baseline (~900 keys in Chrome). On the target page, diff against that baseline. Everything new is app-injected.

```js
// Baseline: run once on about:blank, hardcode the result
const BROWSER_DEFAULTS = new Set(Object.getOwnPropertyNames(window));
// On target page:
const appGlobals = Object.getOwnPropertyNames(window)
  .filter(k => !BROWSER_DEFAULTS.has(k));
```

**Why it works:** Frameworks and bundlers hoist state to `window` for hydration, SSR, and cross-module communication. This catches everything they add.

**Known framework globals to probe directly:**

| Pattern | Framework | Contains |
|---------|-----------|----------|
| `__NEXT_DATA__` | Next.js | Page props, route, build ID |
| `__NUXT__` | Nuxt.js | SSR state, asyncData |
| `__INITIAL_STATE__` / `__PRELOADED_STATE__` | Redux/Vuex | Full store snapshot |
| `__APP_STATE__`, `__DATA__` | Various SSR | Serialized server state |
| `__REACT_DEVTOOLS_GLOBAL_HOOK__` | React | Fiber tree access |
| `webpackChunk*` / `__webpack_modules__` | Webpack | Module registry |

**Angular:** `getAllAngularRootElements()` returns root components; `ng.probe(el).componentInstance` exposes component state. Only works when Angular is in dev mode.

**React fiber walking:** Access via `document.querySelector('#root')._reactRootContainer._internalRoot.current`, then walk the fiber tree via `.child` / `.sibling` / `.return`. Each fiber node has `.memoizedState` (hooks) and `.memoizedProps`.

**Vue:** Any Vue-mounted DOM element has a `__vue__` (Vue 2) or `__vue_app__` (Vue 3) property. Access `el.__vue__.$data` for reactive state.

---

## 2. DOM Data Mining

**data-* attributes:** Apps store entity IDs, state flags, and config in data attributes. Extract all of them:

```js
const dataEls = document.querySelectorAll('*');
const dataMap = {};
dataEls.forEach(el => {
  if (Object.keys(el.dataset).length) dataMap[el.tagName + '#' + el.id] = {...el.dataset};
});
```

**JSON-LD:** Structured data for SEO, often contains product info, org data, breadcrumbs:

```js
const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
  .map(s => JSON.parse(s.textContent));
```

**Meta tags:** `document.querySelectorAll('meta[property], meta[name]')` captures Open Graph (`og:*`), Twitter Cards (`twitter:*`), and custom app metadata. Often contains page title, description, image URLs, and app IDs.

**Hidden inputs:** `document.querySelectorAll('input[type=hidden]')` frequently holds CSRF tokens, session identifiers, feature flags, and entity IDs that the app posts back to the server.

**Table extraction:** Tables are already structured. Walk `<table>` elements, extract headers from `<th>`, map rows to objects. This is WDK's bread and butter for data extraction.

---

## 3. Network/API Discovery

**XHR/fetch interception:** Monkey-patch before the app loads (or retroactively capture future calls):

```js
const _fetch = window.fetch;
const captured = [];
window.fetch = function(...args) {
  captured.push({url: args[0], opts: args[1], time: Date.now()});
  return _fetch.apply(this, args).then(r => {
    r.clone().json().then(d => captured[captured.length-1].response = d).catch(()=>{});
    return r;
  });
};
```

Same pattern for `XMLHttpRequest.prototype.open/send`. This reveals every API endpoint the page talks to, including auth headers and response shapes.

**WebSocket interception:** Override `WebSocket.prototype.send` and hook `onmessage` on construction to capture real-time data streams.

**Why:** API responses contain the richest, most structured data. Knowing the endpoints also lets you replay requests with different parameters.

---

## 4. Storage Mining

**localStorage/sessionStorage:** Both are simple key-value stores. Enumerate and parse:

```js
const storage = {};
for (let i = 0; i < localStorage.length; i++) {
  const k = localStorage.key(i);
  try { storage[k] = JSON.parse(localStorage.getItem(k)); }
  catch { storage[k] = localStorage.getItem(k); }
}
```

**IndexedDB:** List databases with `indexedDB.databases()` (returns a promise). Open each, enumerate object stores via `db.objectStoreNames`, then cursor through records. Often contains cached API responses, offline data, and user preferences.

**Cookies:** `document.cookie.split(';')` gives accessible cookies. Parse into name/value pairs. HttpOnly cookies are invisible to JS but visible in DevTools. Look for session tokens, feature flags, A/B test assignments.

---

## 5. JavaScript State Inspection

**Event listeners:** Chrome's `getEventListeners(el)` reveals all listeners on an element (not available in Firefox). Portable alternative: check `el.onclick`, `el.onchange`, etc., and use `jQuery._data(el, 'events')` if jQuery is present.

**MutationObserver:** Watch for dynamically inserted content (SPAs load data after initial render):

```js
new MutationObserver(mutations => {
  mutations.forEach(m => m.addedNodes.forEach(n => { /* inspect new nodes */ }));
}).observe(document.body, {childList: true, subtree: true});
```

**Closures via toString:** Call `.toString()` on functions found on `window` or as event handlers. Variable names in the source reveal module-scoped state. Combined with `eval` in the same scope (via devtools console), you can sometimes access closed-over variables.

**Custom elements:** `customElements.get('my-component')` returns the class. Instances on the page expose their shadow DOM via `el.shadowRoot` and internal state as properties.

---

## 6. Framework-Specific Extractors

**React:** Walk the fiber tree (see section 1). For each fiber, `memoizedProps` has the component's props, `memoizedState` has hook state (linked list: follow `.next`). `stateNode` gives the class component instance if applicable.

**Vue 2:** `el.__vue__` on any mounted element. Access `$data` for reactive state, `$props`, `$store` for Vuex, `$router` for routes. Walk children via `$children`.

**Vue 3:** `el.__vue_app__` on the mount root. Use `app._instance.proxy` for the root component. Pinia stores are on `app._context.provides`.

**Angular:** `ng.probe(el)` returns a DebugElement. `.componentInstance` has the component's public properties. `.injector` gives access to services.

**Svelte:** Compiled components store state in `$$` internal properties. `el.__svelte_meta` (if present) links to component context.

**jQuery:** `$.data(el)` returns all data associated with an element. `$._data(el, 'events')` lists bound event handlers. `$.fn.jquery` gives the version.

---

## 7. Practical WDK Helper Functions

| Function | Technique | Returns |
|----------|-----------|---------|
| `findAppGlobals()` | Diff `window` keys against hardcoded browser baseline | Array of `{key, type, preview}` for each app-injected global |
| `findFramework()` | Check for `__NEXT_DATA__`, `__vue__`, `ng`, `__svelte_meta`, `jQuery` | `{name, version, entryPoints}` |
| `findAPIEndpoints()` | Monkey-patch fetch/XHR, collect for N seconds | Array of `{method, url, status, responseShape}` |
| `findStructuredData()` | Parse JSON-LD, meta tags, microdata | `{jsonLd: [], meta: {}, microdata: []}` |
| `findHiddenData()` | Hidden inputs + data-* attributes | `{hiddenInputs: [], dataAttributes: {}}` |
| `findStorageData()` | Enumerate localStorage, sessionStorage, IndexedDB, cookies | `{local: {}, session: {}, indexedDB: {}, cookies: []}` |
| `findReactState()` | Fiber tree walk from `#root` | Component tree with props/state at each node |
| `findVueState()` | Walk `__vue__` instances | Component tree with reactive data |

**Implementation priority for WDK:** Start with `findAppGlobals()` and `findStructuredData()` -- these are the highest-signal, lowest-complexity extractors. Add `findStorageData()` next (trivial to implement). Framework-specific extractors come last since they require detection logic and each framework needs its own walker.

**Key constraint:** WDK runs as a bookmarklet, so it can't intercept network calls that already happened before injection. `findAPIEndpoints()` must either (a) be injected early via a userscript manager, or (b) trigger a page action (scroll, click) to capture subsequent requests, or (c) parse the Performance API's `performance.getEntriesByType('resource')` for URL-only history of past requests (no response bodies, but the endpoint URLs are visible).
