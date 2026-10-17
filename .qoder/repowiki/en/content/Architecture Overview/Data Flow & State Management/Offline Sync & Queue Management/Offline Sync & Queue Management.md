# Offline Sync & Queue Management

<cite>
**Referenced Files in This Document**
- [offline.ts](file://src/lib/offline.ts)
- [pos.tsx](file://src/lib/pos.tsx)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains the offline-first architecture and queue management system used by the POS register. It focuses on how transactions are safely queued locally when network connectivity is lost, how they are persisted to the browser’s local storage, and how automatic synchronization resumes once the device is online again. It also documents the `QueuedSale` data structure, retry behavior, error handling, and the user-facing feedback provided through the offline banner component.

## Project Structure
The offline sync logic is implemented across two core files:

- `src/lib/offline.ts`: Defines the persistent queue model, reference generation helpers, and utilities for loading/saving the queue and detecting network errors. It also manages a lightweight cache of reference data for instant start-up.
- `src/lib/pos.tsx`: Implements the POS provider, including checkout orchestration, queue state management, automatic background synchronization, and the offline banner UI.

```mermaid
graph TB
subgraph "POS Provider"
POS["pos.tsx<br/>Provider, checkout, syncQueue, banner"]
end
subgraph "Offline Utilities"
OFF["offline.ts<br/>QueuedSale, load/save queue,<br/>isNetworkError, newRef,<br/>cache hydration/persistence"]
end
subgraph "Browser Storage"
LS["localStorage<br/>Queue + cached reference data"]
end
subgraph "Backend"
RPC["Supabase RPC<br/>checkout_ref"]
end
POS --> OFF
POS --> LS
POS --> RPC
OFF --> LS
```

**Diagram sources**
- [pos.tsx:249-345](file://src/lib/pos.tsx#L249-L345)
- [offline.ts:62-91](file://src/lib/offline.ts#L62-L91)

**Section sources**
- [offline.ts:1-91](file://src/lib/offline.ts#L1-L91)
- [pos.tsx:109-440](file://src/lib/pos.tsx#L109-L440)

## Core Components
- `QueuedSale`: The queue item shape that represents a sale attempted while offline. It includes a unique client reference, timestamp, estimated total, store association, original checkout arguments, and optional error text.
- Queue persistence: `loadQueue` and `saveQueue` read/write the queue array from `localStorage`, keyed by user ID.
- Network detection: `isNetworkError` recognizes common network-related error messages so failed operations can be retried or queued.
- Reference generator: `newRef` creates stable identifiers for each queued transaction.
- POS provider integration: The provider orchestrates checkout, maintains queue state, runs periodic syncs, and renders an offline banner with retry and discard actions.

**Section sources**
- [offline.ts:62-91](file://src/lib/offline.ts#L62-L91)
- [pos.tsx:249-345](file://src/lib/pos.tsx#L249-L345)

## Architecture Overview
The offline-first flow ensures sales continue even without internet access:

1. When the user completes a checkout, the provider attempts a server call.
2. If offline or a network error occurs (and offline mode is allowed), the sale is enqueued locally with a generated reference and immediate “completed” feedback to the user.
3. The queue is persisted to `localStorage`.
4. When the device becomes online and staff is authenticated, the provider automatically synchronizes pending items every 30 seconds.
5. Successful syncs remove the item from the queue; failures mark the item with a masked error message and allow manual retry or discard.

```mermaid
sequenceDiagram
participant User as "User"
participant POS as "POS Provider<br/>pos.tsx"
participant Net as "Network"
participant LS as "localStorage"
participant Server as "Supabase RPC<br/>checkout_ref"
User->>POS : "checkout(args, { offlineOk, estTotal })"
alt Online and no error
POS->>Server : "checkout_ref(p_client_ref, ...args)"
Server-->>POS : "CheckoutResult"
POS-->>User : "Completed result"
else Offline or network error
POS->>LS : "saveQueue(userId, [...queue, QueuedSale])"
POS-->>User : "Immediate offline-completed result"
end
Note over POS,Net : "Background sync loop"
POS->>POS : "syncQueue() every 30s when online"
POS->>LS : "loadQueue(userId)"
loop For each pending item
POS->>Server : "checkout_ref(...item.args)"
alt Success
Server-->>POS : "OK"
POS->>LS : "remove item from queue"
else Failure
Server-->>POS : "Error"
POS->>LS : "mark item with masked error"
end
end
```

**Diagram sources**
- [pos.tsx:275-338](file://src/lib/pos.tsx#L275-L338)
- [offline.ts:71-84](file://src/lib/offline.ts#L71-L84)

## Detailed Component Analysis

### QueuedSale Data Model
`QueuedSale` captures all information needed to replay a sale later:

- `ref`: Unique client-generated identifier for the transaction.
- `at`: ISO timestamp when the sale was created.
- `total`: Estimated total at time of creation.
- `storeId`: Store associated with the sale.
- `args`: Original checkout arguments passed to the server function.
- `error?`: Optional masked error message if a sync attempt failed.

```mermaid
classDiagram
class QueuedSale {
+string ref
+string at
+number total
+string storeId
+Record~string, unknown~ args
+string error
}
```

**Diagram sources**
- [offline.ts:62-69](file://src/lib/offline.ts#L62-L69)

**Section sources**
- [offline.ts:62-69](file://src/lib/offline.ts#L62-L69)

### Checkout Function and Offline Handling
The `checkout` function implements the primary decision point:

- Generates a unique reference using `newRef`.
- If offline mode is allowed and the device is offline, it immediately enqueues the sale and returns a local “completed” result.
- Otherwise, it calls the server RPC. On a network error (detected via `isNetworkError`) and when offline mode is allowed, it enqueues the sale instead of throwing.
- On non-network errors, it throws to the caller.

```mermaid
flowchart TD
Start(["checkout(args, opts)"]) --> GenRef["Generate ref via newRef()"]
GenRef --> CheckOffline{"Offline allowed AND device offline?"}
CheckOffline --> |Yes| Enqueue["Enqueue QueuedSale<br/>return offline result"]
CheckOffline --> |No| CallRPC["Call server checkout_ref"]
CallRPC --> RPCSuccess{"RPC success?"}
RPCSuccess --> |Yes| ReturnOK["Return server result"]
RPCSuccess --> |No| IsNetErr{"isNetworkError(message)?"}
IsNetErr --> |Yes| Enqueue
IsNetErr --> |No| ThrowErr["Throw error to caller"]
```

**Diagram sources**
- [pos.tsx:275-307](file://src/lib/pos.tsx#L275-L307)
- [offline.ts:83-91](file://src/lib/offline.ts#L83-L91)

**Section sources**
- [pos.tsx:275-307](file://src/lib/pos.tsx#L275-L307)
- [offline.ts:83-91](file://src/lib/offline.ts#L83-L91)

### Synchronization Process (`syncQueue`)
`sychQueue` is responsible for replaying queued sales:

- Guards against concurrent syncs and requires both staff authentication and online status.
- Loads pending items (excluding those already marked with an error).
- Iterates through pending items and calls the server RPC with the stored arguments.
- On success, removes the item from the queue.
- On failure:
  - Stops further processing if the error indicates the device is locked or a network issue.
  - Marks the failing item with a masked error message.
- After any successful sync, invalidates relevant query keys to refresh UI data.

```mermaid
flowchart TD
Enter(["syncQueue()"]) --> Guard{"Staff present AND online?"}
Guard --> |No| Exit["Exit"]
Guard --> |Yes| LoadQ["Load pending queue (exclude errored)"]
LoadQ --> HasPending{"Any pending?"}
HasPending --> |No| Exit
HasPending --> |Yes| Loop["For each pending item"]
Loop --> CallRPC["Call checkout_ref(item.args)"]
CallRPC --> Result{"RPC result"}
Result --> |Success| Remove["Remove item from queue"]
Result --> |Failure| ErrType{"Network/Locked error?"}
ErrType --> |Yes| Break["Stop sync loop"]
ErrType --> |No| MarkErr["Mark item with masked error"]
Remove --> Next["Next item"]
MarkErr --> Next
Next --> Loop
Break --> Done["Finish sync"]
Done --> Invalidate["Invalidate affected queries"]
```

**Diagram sources**
- [pos.tsx:310-338](file://src/lib/pos.tsx#L310-L338)

**Section sources**
- [pos.tsx:310-338](file://src/lib/pos.tsx#L310-L338)

### Automatic Sync Timer
When conditions are met, the provider starts a timer that triggers `syncQueue` every 30 seconds:

- Conditions: device is online, staff is authenticated, and not all queue items are in error state.
- Cleanup: the interval is cleared when dependencies change or the component unmounts.

```mermaid
stateDiagram-v2
[*] --> Idle
Idle --> Syncing : "online && staff && has pending"
Syncing --> Idle : "every 30s until all synced or errored"
```

**Diagram sources**
- [pos.tsx:340-345](file://src/lib/pos.tsx#L340-L345)

**Section sources**
- [pos.tsx:340-345](file://src/lib/pos.tsx#L340-L345)

### Local Storage Persistence
Two types of data are persisted in `localStorage`:

- Transaction queue: keyed by user ID, storing an array of `QueuedSale`.
- Cached reference data: a snapshot of safe-to-persist query results (e.g., business, stores, products, collections, stock, staff names) to enable instant start-up.

Key behaviors:

- Queue load/save functions handle malformed data gracefully and return empty arrays on parse errors.
- Cache hydration restores last-known reference data into React Query with a stale marker so it refreshes in the background.
- Cache persistence watches query updates and debounces writes to avoid excessive storage writes.

```mermaid
flowchart TD
AppStart["App start"] --> Hydrate["hydrateCache(qc, userId)"]
Hydrate --> ReadCache["Read localStorage cache"]
ReadCache --> ValidVersion{"Valid version?"}
ValidVersion --> |Yes| Inject["Inject into QueryClient with updatedAt=0"]
ValidVersion --> |No| Ignore["Ignore cache"]
Inject --> Run["Run app with instant-start data"]
Run --> Watch["persistCache watches query updates"]
Watch --> Debounce["Debounce save to localStorage"]
```

**Diagram sources**
- [offline.ts:15-55](file://src/lib/offline.ts#L15-L55)

**Section sources**
- [offline.ts:15-55](file://src/lib/offline.ts#L15-L55)
- [offline.ts:71-81](file://src/lib/offline.ts#L71-L81)

### Error States and User Feedback (Offline Banner)
The provider renders an offline banner that communicates current state and offers actions:

- Shows whether the device is online or offline.
- Displays count of items waiting to sync and prompts unlocking if required.
- Provides a “Sync now” button when online and staffed.
- For failed items, shows masked error text and allows:
  - Retry: clears the error flag so the item can be retried during the next sync cycle.
  - Discard: removes the failed item after confirmation.

```mermaid
flowchart TD
State["Queue state changes"] --> Render["Render offline banner"]
Render --> Status{"Online?"}
Status --> |No| ShowOffline["Show offline indicator"]
Status --> |Yes| ShowOnline["Show online indicator"]
ShowOnline --> HasPending{"Has pending items?"}
HasPending --> |Yes| ShowPending["Show waiting-to-sync count"]
HasPending --> |No| End["No banner"]
ShowPending --> ManualSync["Manual 'Sync now' button"]
ShowPending --> FailedItems{"Any failed items?"}
FailedItems --> |Yes| ShowFailed["Show masked error + Retry/Discard"]
FailedItems --> |No| End
```

**Diagram sources**
- [pos.tsx:389-433](file://src/lib/pos.tsx#L389-L433)

**Section sources**
- [pos.tsx:389-433](file://src/lib/pos.tsx#L389-L433)

## Dependency Analysis
The following diagram maps key relationships between modules and external services:

```mermaid
graph LR
POS["pos.tsx<br/>PosProvider"] --> OFF["offline.ts<br/>QueuedSale, load/save, isNetworkError, newRef"]
POS --> LS["localStorage<br/>queue + cache"]
POS --> RPC["Supabase RPC<br/>checkout_ref"]
OFF --> LS
```

**Diagram sources**
- [pos.tsx:109-440](file://src/lib/pos.tsx#L109-L440)
- [offline.ts:15-91](file://src/lib/offline.ts#L15-L91)

**Section sources**
- [pos.tsx:109-440](file://src/lib/pos.tsx#L109-L440)
- [offline.ts:15-91](file://src/lib/offline.ts#L15-L91)

## Performance Considerations
- Debounced cache persistence avoids frequent `localStorage` writes by batching updates after query changes.
- The sync loop runs only when online and staffed, preventing unnecessary work.
- Network error detection short-circuits sync loops on transient issues, reducing repeated retries.
- Using a single shared queue state and persisting only when changed minimizes storage overhead.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common scenarios and their handling:

- Device goes offline during checkout:
  - If offline mode is allowed, the sale is queued and the user sees an immediate “completed” result.
  - The offline banner indicates sales were saved locally.
- Network error during sync:
  - The failing item is marked with a masked error.
  - The sync loop stops on network or lock errors to prevent repeated failures.
- Manual retry:
  - Users can clear the error flag for a failed item; the next sync will retry it.
- Discarding failed items:
  - Users can confirm removal of a failed item from the queue.
- Auto-lock interactions:
  - If the session locks during sync, the loop stops; the user must unlock to resume syncing.

**Section sources**
- [pos.tsx:310-338](file://src/lib/pos.tsx#L310-L338)
- [pos.tsx:389-433](file://src/lib/pos.tsx#L389-L433)

## Conclusion
Storq POS implements a robust offline-first design centered around a durable local queue and automatic background synchronization. Sales are captured instantly when offline, persisted safely, and replayed reliably once connectivity is restored. Clear user feedback and controlled retry behavior ensure a smooth experience even under adverse network conditions.

[No sources needed since this section summarizes without analyzing specific files]