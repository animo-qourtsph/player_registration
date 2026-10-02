# Animo Player Registration — Phase C Dark Launch

Build: `production-1.2.22-phase-c-dark-launch`

## Purpose

This build adds a capability handshake with Registration API Phase B while preserving the existing live single-entry registration experience.

## Safety behavior

- Existing API contract remains `2026.09.14.1`.
- Existing schema requirement remains `2026.09.14.1`.
- No second-entry UI is exposed.
- No email-verification UI is exposed.
- `PLAYER_DARK_LAUNCH` is hard-coded to `true`.
- Backend feature flags alone cannot expose the new player UX.
- Existing submission/payment/tracker flows are unchanged.

## Runtime diagnostic

After the page initializes, browser DevTools can inspect:

```js
window.__ANIMO_PLAYER_RUNTIME__
```

Expected during Phase C:

```text
darkLaunch: true
capabilities.doubleEntryFoundationReady: true
capabilities.doubleEntryConfiguredEnabled: false
capabilities.doubleEntryWritePathEnabled: false
capabilities.emailVerificationConfiguredEnabled: false
capabilities.emailVerificationWritePathEnabled: false
features.doubleEntryUiEnabled: false
features.emailVerificationUiEnabled: false
```

Do not remove the dark-launch gate until the v2 write path, database activation migration, and player UI have passed regression testing together.
