# System Architecture Diagrams

## Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Web Application                              │
│                    (Node.js + Express + Handlebars)                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
        ┌───────────▼───────────┐   │   ┌──────────▼──────────┐
        │   Failure Recovery    │   │   │  Transaction Mgmt   │
        │      Dashboard        │   │   │      Features       │
        └───────────────────────┘   │   └─────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
        ┌───────────▼───────────┐       ┌──────────▼──────────┐
        │  Background Recovery  │       │   Queue Management  │
        │       Monitor         │       │   (In-Memory)       │
        │   (Every 30 seconds)  │       │                     │
        └───────────────────────┘       └─────────────────────┘
                                                    │
        ┌───────────────────────────────────────────┤
        │                                           │
        ▼                                           ▼
┌───────────────┐                          ┌───────────────┐
│ missedWrites  │                          │ Recovery      │
│   [0]: []     │ Central Node            │   Logic       │
│   [1]: []     │ Partition 1             │               │
│   [2]: []     │ Partition 2             └───────────────┘
└───────────────┘
        │
        └────────────────┬────────────────┐
                         │                │
        ┌────────────────▼─────┐  ┌───────▼──────────┐
        │                      │  │                  │
        │  ERROR CLASSIFIER    │  │  RETRY ENGINE    │
        │                      │  │                  │
        │  • RETRYABLE         │  │  • Max 3 tries   │
        │  • PERMANENT         │  │  • 500ms delay   │
        │  • UNKNOWN           │  │  • Exponential   │
        │                      │  │    backoff       │
        └──────────────────────┘  └──────────────────┘
```

## Database Topology

```
┌─────────────────────────────────────────────────────────────┐
│                     DATABASE LAYER                          │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Central     │      │  Partition 1 │      │  Partition 2 │
│   Node 0     │      │   Node 1     │      │   Node 2     │
│              │      │              │      │              │
│  ALL DATA    │      │ Countries    │      │ Countries    │
│  Master Copy │      │   M - Z      │      │   A - L      │
│              │      │              │      │              │
│  • Philippines│      │ • Mexico    │      │ • Australia │
│  • USA       │      │ • Philippines│      │ • Canada    │
│  • Canada    │      │ • USA       │      │ • Germany   │
│  • ...       │      │ • ...       │      │ • ...       │
└──────────────┘      └──────────────┘      └──────────────┘
   Port: 3306           Port: 3307           Port: 3308
```

## Case #3: Replication Failure Flow

```
┌─────────┐
│  User   │ Clicks "Run Case #3"
└────┬────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│              PHASE 1: Write to Central              │
│                                                     │
│  1. BEGIN TRANSACTION                               │
│  2. INSERT INTO users VALUES (...)                  │
│  3. COMMIT                                          │
│  4. ✓ SUCCESS                                       │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│           PHASE 2: Replicate to Partitions          │
│                                                     │
│  ┌──────────────────┐         ┌──────────────────┐ │
│  │  Partition 1     │         │  Partition 2     │ │
│  │  (M-Z)          │         │  (A-L)          │ │
│  └────────┬─────────┘         └────────┬─────────┘ │
│           │                            │           │
│           ▼                            ▼           │
│    ┌────────────┐               ┌────────────┐    │
│    │ isHealthy? │               │ isHealthy? │    │
│    │    YES     │               │    NO      │    │
│    └─────┬──────┘               └─────┬──────┘    │
│          │                            │           │
│          ▼                            ▼           │
│    ┌────────────┐               ┌────────────┐    │
│    │  INSERT    │               │  TIMEOUT   │    │
│    │ ✓ SUCCESS  │               │ ✗ FAILED   │    │
│    └────────────┘               └─────┬──────┘    │
│                                       │           │
│                                       ▼           │
│                          ┌────────────────────┐   │
│                          │  Queue Write:      │   │
│                          │  {                 │   │
│                          │    query: "...",   │   │
│                          │    params: [...],  │   │
│                          │    timestamp: T,   │   │
│                          │    attempts: 1     │   │
│                          │  }                 │   │
│                          └────────────────────┘   │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│              USER SEES: ✓ SUCCESS                   │
│                                                     │
│  • Data committed to Central                        │
│  • Write queued for Partition 2                     │
│  • User NOT aware of replication failure            │
│  • Can immediately read from Central                │
└─────────────────────────────────────────────────────┘
```

## Case #4: Recovery Flow

```
┌─────────┐
│  User   │ Clicks "Run Case #4"
└────┬────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│         Check Queue for Pending Writes              │
│                                                     │
│  Partition 1: 0 writes (skip)                       │
│  Partition 2: 5 writes ← PROCESS THESE             │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│              Check Node Health                      │
│                                                     │
│  isHealthy(partition2, timeout=1000ms)              │
│  Result: ✓ ONLINE                                   │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│          Process Each Queued Write                  │
│                                                     │
│  For write #1 of 5:                                 │
│    ┌───────────────────────────────────┐            │
│    │ 1. Check if already exists        │            │
│    │    SELECT id FROM users WHERE ... │            │
│    └──────────────┬────────────────────┘            │
│                   │                                 │
│         ┌─────────┴──────────┐                      │
│         │                    │                      │
│         ▼                    ▼                      │
│    ┌─────────┐         ┌──────────┐                │
│    │ EXISTS  │         │  MISSING │                │
│    │ (skip)  │         │ (apply)  │                │
│    └─────────┘         └────┬─────┘                │
│                             │                       │
│                             ▼                       │
│                   ┌──────────────────┐              │
│                   │ Retry with       │              │
│                   │ Error Handling:  │              │
│                   │                  │              │
│                   │ Try 1: Execute   │              │
│                   │   ↓              │              │
│                   │ Fail? → Try 2    │              │
│                   │   ↓              │              │
│                   │ Fail? → Try 3    │              │
│                   │   ↓              │              │
│                   │ Success or Error │              │
│                   └────────┬─────────┘              │
│                            │                        │
│            ┌───────────────┴────────────────┐       │
│            │                                │       │
│            ▼                                ▼       │
│      ┌──────────┐                   ┌──────────┐   │
│      │ SUCCESS  │                   │  FAILED  │   │
│      │ Remove   │                   │  Keep in │   │
│      │ from     │                   │  queue   │   │
│      │ queue    │                   │          │   │
│      └──────────┘                   └──────────┘   │
│                                                     │
│  Repeat for writes #2, #3, #4, #5...               │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│              Recovery Summary                       │
│                                                     │
│  Total Processed: 5                                 │
│  ✓ Successful: 4                                    │
│  ⚠ Skipped (Duplicates): 1                         │
│  ✗ Failed: 0                                        │
│  Remaining in Queue: 0                              │
│                                                     │
│  Status: ✓ FULLY SYNCHRONIZED                      │
└─────────────────────────────────────────────────────┘
```

## Background Monitor Flow

```
┌──────────────────────────────────────────────────────┐
│           Background Recovery Monitor                │
│               (Runs every 30 seconds)                │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  Check: Any queued writes?    │
        └───────────────┬───────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
        ┌────────┐            ┌────────┐
        │   NO   │            │  YES   │
        │ (skip) │            │        │
        └────────┘            └───┬────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ For each partition:      │
                    │   If has missed writes:  │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
        ┌─────────────────────┐   ┌─────────────────────┐
        │  Check Health       │   │  Check Health       │
        │  Partition 1        │   │  Partition 2        │
        └──────────┬──────────┘   └──────────┬──────────┘
                   │                         │
        ┌──────────┴──────────┐   ┌─────────┴──────────┐
        │                     │   │                    │
        ▼                     ▼   ▼                    ▼
   ┌────────┐          ┌────────────┐           ┌────────┐
   │OFFLINE │          │  ONLINE    │           │OFFLINE │
   │(skip)  │          │  (recover) │           │(skip)  │
   └────────┘          └─────┬──────┘           └────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │  Apply Missed Writes   │
                │  (Same as Case #4)     │
                └────────────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │  Log Results:          │
                │  [Monitor] Partition 1:│
                │  Recovered 3 writes    │
                └────────────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │  Update Statistics:    │
                │  • totalRecoveries++   │
                │  • lastRecoveryTime    │
                └────────────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │   Wait 30 seconds...   │
                └────────────────────────┘
                             │
                             └──────► (repeat)
```

## Error Classification Decision Tree

```
                    ┌──────────────┐
                    │  Error?      │
                    └───────┬──────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
    ┌──────────────┐              ┌──────────────┐
    │ Network/     │              │ Database/    │
    │ Connection   │              │ Data Error   │
    └───────┬──────┘              └───────┬──────┘
            │                             │
            ▼                             ▼
┌───────────────────────┐     ┌───────────────────────┐
│ RETRYABLE:            │     │ Duplicate?            │
│ • ETIMEDOUT           │     └──────────┬────────────┘
│ • ECONNREFUSED        │                │
│ • ECONNRESET          │     ┌──────────┴──────────┐
│ • ER_LOCK_DEADLOCK    │     │                     │
│                       │     ▼                     ▼
│ Action:               │ ┌────────┐        ┌────────────┐
│ → Retry 3x            │ │  YES   │        │     NO     │
│ → 500ms delay         │ │ (skip) │        │ (classify) │
│ → Keep in queue       │ └────────┘        └──────┬─────┘
└───────────────────────┘                          │
                                                   ▼
                                    ┌──────────────────────┐
                                    │ PERMANENT:           │
                                    │ • ER_DUP_ENTRY       │
                                    │ • ER_NO_REFERENCED_  │
                                    │   ROW                │
                                    │ • ER_PARSE_ERROR     │
                                    │                      │
                                    │ Action:              │
                                    │ → Do NOT retry       │
                                    │ → Remove from queue  │
                                    │ → Log for manual     │
                                    │   review             │
                                    └──────────────────────┘
```

## Data Consistency Timeline

```
Time →
════════════════════════════════════════════════════════════

T0: All nodes synchronized
    Central:    [A, B, C, D]
    Partition1: [B, D]  (M-Z countries)
    Partition2: [A, C]  (A-L countries)

T1: Partition2 goes OFFLINE
    Central:    [A, B, C, D]  ✓
    Partition1: [B, D]        ✓
    Partition2: OFFLINE       ✗

T2: Write "E" (country: Canada, goes to Partition2)
    User Action: Create user
    Result: ✓ SUCCESS (user sees this)
    
    Central:    [A, B, C, D, E]  ✓ committed
    Partition1: [B, D]           (no change)
    Partition2: OFFLINE          ✗ failed
    
    Queue[2]: [E]  ← Queued for recovery

T3: Write "F" (country: USA, goes to Partition1)
    User Action: Create user
    Result: ✓ SUCCESS
    
    Central:    [A, B, C, D, E, F]  ✓ committed
    Partition1: [B, D, F]            ✓ replicated
    Partition2: OFFLINE              ✗ failed
    
    Queue[2]: [E]  (F not queued, went to P1)

T4: Write "G" (country: Australia, goes to Partition2)
    User Action: Create user
    Result: ✓ SUCCESS
    
    Central:    [A, B, C, D, E, F, G]  ✓ committed
    Partition1: [B, D, F]              (no change)
    Partition2: OFFLINE                ✗ failed
    
    Queue[2]: [E, G]  ← Added to queue

T5: Partition2 comes back ONLINE
    Central:    [A, B, C, D, E, F, G]  ✓
    Partition1: [B, D, F]              ✓
    Partition2: [A, C]                 ⚠ STALE (missing E, G)
    
    Queue[2]: [E, G]  ← Waiting for recovery

T6: Recovery Process (Case #4 or Background Monitor)
    Processing queue[2]...
    
    Write E: Check → Not exists → INSERT ✓
    Write G: Check → Not exists → INSERT ✓
    
    Queue[2]: []  ← Cleared

T7: All nodes synchronized again
    Central:    [A, B, C, D, E, F, G]  ✓
    Partition1: [B, D, F]              ✓
    Partition2: [A, C, E, G]           ✓ RECOVERED
    
    Status: FULLY CONSISTENT ✓
```

## User Experience During Failure

```
┌─────────────────────────────────────────────────────────┐
│              USER PERSPECTIVE                           │
└─────────────────────────────────────────────────────────┘

Scenario: User creates a record while Partition2 is down

Step 1: Submit form
┌──────────────────┐
│ Create User Form │
│ Name: John Doe   │
│ Country: Canada  │
│ [Submit Button]  │ ← User clicks
└──────────────────┘

Step 2: Backend processes
        (User sees loading indicator)
        
        Central Node: ✓ Write successful
        Partition2:   ✗ Offline (user unaware)

Step 3: User sees result
┌──────────────────────────────────┐
│  ✓ Success!                      │
│  User created successfully       │
│  ID: 12345                       │
│                                  │
│  [View Record] [Create Another]  │
└──────────────────────────────────┘

Step 4: User views record (immediately)
        Query: Central Node
        Result: ✓ Record found
        Display: All data visible

USER EXPERIENCE:
━━━━━━━━━━━━━━━━
✓ No errors shown
✓ No delays experienced
✓ Data immediately available
✓ Completely transparent failure handling

BEHIND THE SCENES:
━━━━━━━━━━━━━━━━━━
⚡ Write queued for Partition2
⚡ Background monitor will recover
⚡ Eventual consistency maintained
⚡ Zero user impact
```

---

**Legend:**
- ✓ = Success
- ✗ = Failure
- ⚠ = Warning
- → = Flow direction
- ← = Annotation

These diagrams show the complete architecture and flow of the distributed database failure recovery system.
