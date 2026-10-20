# LinkPulse Render Free deployment patch

This package replaces the earlier shortcut that immediately counted every non-bot-looking request as a qualified human click. The API now polls the durable MongoDB outbox and calls the same rule classifier used by the optional worker, so mobile/desktop detection, qualified daily chart data, and traffic classification do not rely on a paid Render Background Worker.

## Update your existing services

1. Copy the changed/new files from this package into the same paths in your repository. Commit and push to `main` in `divyanshuand6-art/99999`. Do not copy any `.env` file or secrets.
2. In Render, open `linkpulse-api` → **Environment**. Add `INLINE_CLICK_PROCESSOR` = `true`. It defaults to enabled in code, but setting it explicitly documents the free deployment mode.
3. Add `MOCK_BILLING_ENABLED` = `true` to `linkpulse-api` → **Environment**. This enables only the simulated demo checkout: no card/UPI details are collected and no real money is charged. Without this explicit variable, the checkout remains disabled in production by design.
4. Save changes and wait for the API deployment/restart. Render should show logs similar to `Inline MongoDB click processor started`.
5. Open a short link in a regular browser, wait 2–3 seconds, return to the dashboard, and press Refresh. Existing unprocessed click events in the MongoDB outbox should also be processed. Known bot signatures stay unqualified; other events go through rate/behavior-based classification.
6. For subscription testing, choose Pro or Growth and complete the **simulated** checkout. The signed-in account should show the selected plan for 30 days and a mock transaction in billing history. This is a demo only, not a real payment gateway.

## Render Blueprint

`render.yaml` now defines only the free API web service and free static frontend; it does not try to create a paid background worker or a Redis/Key Value service. The blueprint explicitly enables the demo checkout. Disable `MOCK_BILLING_ENABLED` when you do not want the public demo to grant simulated paid entitlements.
