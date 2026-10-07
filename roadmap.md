# Storq visual refresh
## Paid store enforcement
- [ ] Research Shopify POS per-location subscriptions and audit Storq billing.
- [ ] Enforce paid store capacity server-side and explain capacity in Stores and Billing.
- [ ] Verify guards, payment activation, and app checks.

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