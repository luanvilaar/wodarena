---
name: browser-check-cdp
description: How to do the stories' browser check here without Playwright, using headless Google Chrome over the DevTools Protocol, and which pages need no login
metadata:
  type: reference
---

The repo has no Playwright or Puppeteer, but Google Chrome is installed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Node 22 has a global `WebSocket`.

A short script works (used on 2026-10-21 for Story 1.61). It launches Chrome with `--headless=new --remote-debugging-port=N --user-data-dir=<tmp>`, reads `/json/list`, and drives `Runtime.evaluate`, `Emulation.setDeviceMetricsOverride` and `Page.captureScreenshot`. To fill React inputs, call the native value setter and then dispatch an `input` event.

The user often has `npm run dev` already running on :3000. The dev-only pages `/pt-br/sumula-preview` and `/pt-br/sumula-preview/editor` need no login or database.

To test clock-driven sheets (AMRAP, Intervalado) without waiting, inject `Page.addScriptToEvaluateOnNewDocument` that wraps `Date.now` with an adjustable offset: `SheetDemo` derives elapsed time from `Date.now`, so moving the offset jumps the sheet clock to an exact second (used for 01:59/02:00 in Story 1.62). Real taps and holds work through `Input.dispatchMouseEvent` at the tile center. The preview page is dark; add `court-light` to `main` to see the court theme (the preview fixture buttons then render white on white, which is only an artifact of the injection).

The telão page (`/pt-br/telao/<any token>`) renders without touching the database; all its data comes from `GET /api/telao/*`. Enable `Fetch.enable` with pattern `*/api/telao/*` and answer `Fetch.requestPaused` with `Fetch.fulfillRequest` and a `BroadcastPayload` fixture, so the request never reaches the server or the production DB (used 2026-10-22 for Story 1.63). Set `serverTime` to now and `startedAt` to now minus the wanted elapsed time to land the heat clock on an exact second. The first `header` in the DOM is the site navbar, so query the telão header by its class.

**How to apply:**
- Use the dev-only pages for builder and sheet checks.
- Do not use the logged-in admin panel for these checks, because the single database is production. Say explicitly that the admin panel was not opened.
- Open the approved maquete straight from `file://docs/design/...` to compare it side by side.
- See also [[coderabbit-own-commit]].
