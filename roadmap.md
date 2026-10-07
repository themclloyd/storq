# Storq visual refresh
## Paid store enforcement
- [x] Research Shopify POS per-location subscriptions and audit Storq billing.
- [x] Enforce paid store capacity server-side and explain capacity in Stores and Billing.
- [x] Verify guards, payment activation, and app checks with 22 tests and rollback-only database checks.
- [ ] Verify a real payment and signed-in store creation through the UI. Blocker: external unmanaged sign-in has no available session.

Verification: build OK; database checks passed for store limits, over-capacity write denial, activation, duplicate confirmations and proportional prepaid credit; no test records retained. Live billing redirects to sign-in without runtime errors.

- [x] Apply light workspace tokens with charcoal text, lime accents and consistent controls.
- [x] Refresh navigation, sign-in and billing presentation without changing workflows.
- [x] Check content-page metadata and verify accessible screens.

Verification: light-mode sign-in checked visually; build OK. Signed-in billing and dashboard checks are unavailable with this project's external sign-in setup.

## Store-aware navigation
- [x] Group inventory, sales, financial and business tools without removing existing URLs or staff access.
- [x] Show approval workflows only for approval stores and keep layby in both types.
- [x] Test navigation policies and checkout controls; check preview where access is available.
- [ ] Verify signed-in tab navigation and store switching end-to-end. Blocker: external unmanaged sign-in has no available authenticated test session.

Verification: 15 navigation/checkout/routing tests passed; build OK. Preview reaches sign-in without runtime errors. Switching stores remounts page state to prevent carrying checkout or open dialogs into another store.