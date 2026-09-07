# Getting Started

This guide will help you get started with askit in your project.

**askit** is a UI component library and API layer built on top of [keel](https://github.com/GoAskAway/keel). Through package.json conditional exports, the same `import { StepList, Toast } from 'askit'` delivers real React Native components on the Host side and string identifiers on the Guest side (which keel passes to Host for rendering).

## Prerequisites

- Node.js 18+
- React 19+ / React Native 0.82+ (for Host App)
- keel engine (for Guest sandbox)

## Installation

```bash
bun add github:GoAskAway/askit
```

> **Note**: askit is published via GitHub and exports TypeScript source directly (no build step required). Your bundler (Metro, Vite, etc.) needs to support TypeScript compilation. Both React Native Metro and modern bundlers handle this automatically.

## Basic Setup

### For Guest Development

#### Talking to the Host

```typescript
import { ask, http } from 'askit';

// RPC: requestId auto-generated, response typed from contracts
const appInfo = await ask.call('GET_APP_INFO');

// One-way notification
ask.send('GUEST_SLEEP_STATE', { sleeping: true });

// HTTP via host proxy
const res = await http.get<{ code: number }>('https://api.example.com');
```

In your guest code, simply import and use the APIs:

```typescript
import { EventEmitter, Toast, Haptic } from 'askit';

// Initialize your guest
EventEmitter.emit('guest:init', { name: 'MyGuest', version: '1.0.0' });

// Listen for host events
EventEmitter.on('host:ready', () => {
  Toast.show('Guest connected!');
});
```

### For Host App Integration

In your React Native host app:

```typescript
import { createEngineAdapter, components } from 'askit/core';
import { EventHandler } from 'askit';
import { Engine } from 'keel';

// Create and configure engine
const engine = new Engine();

// Connect askit bridge
const adapter = createEngineAdapter(engine);

// Register all askit components
engine.register(components);

// Register RPC handlers — without this, ask.call from the guest
// (GET_APP_INFO, HTTP_REQUEST, ...) never gets a response and only times out.
// Handlers are plain functions; the response event is resolved from the
// contract EVENT_PAIRS at dispatch time.
const unsubscribe = EventHandler.setup(engine, {
  tabId: 'tab-1',
  handlers: {
    GET_APP_INFO: async () => ({ appName: 'demo', logo: '', languageContents: null, favoriteCount: 0, usedCount: 0, author: 'askit' }),
  },
});

// Load and run guest (supports URL or bundled code string)
await engine.loadBundle('https://example.com/guest.js');

// On teardown: unsubscribe()
```

## Project Structure

A typical AskAway project structure:

```
my-askaway-app/
├── host/                 # React Native host app
│   ├── src/
│   │   ├── App.tsx
│   │   └── engine/
│   │       └── setup.ts  # Engine configuration
│   └── package.json
├── guests/              # Guest projects
│   └── my-guest/
│       ├── src/
│       │   └── index.ts
│       └── package.json
└── package.json
```

## Next Steps

- [API Reference](./api-reference.md) - Learn about EventEmitter, Toast, and Haptic APIs
- [Components](./components.md) - Explore UI components
- [Architecture](./architecture.md) - Understand the isomorphic design
