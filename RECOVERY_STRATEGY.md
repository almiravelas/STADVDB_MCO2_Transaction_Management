# Distributed Database Recovery Strategy Documentation

## Overview

This document explains how the distributed database system handles failures, recovers from them, and shields users from node failures while maintaining data consistency.

## System Architecture

### Nodes Configuration
- **Central Node (Node 0)**: Master database containing all records
- **Partition 1 (Node 1)**: Contains records for countries M-Z (Mexico, Philippines, USA, etc.)
- **Partition 2 (Node 2)**: Contains records for countries A-L (Australia, Canada, Germany, etc.)

## Failure Recovery Cases

### Case #3: Central → Partition Replication Failure

**Scenario**: A transaction successfully commits to the Central Node but fails to replicate to one or more Partition Nodes.

#### How It Works:

1. **Write to Central Node**
   - Transaction begins on Central Node
   - Data is written and committed
   - Transaction ID and timestamp recorded
   - User receives success confirmation

2. **Attempt Replication**
   - System attempts to replicate to both partitions
   - Each partition is checked for health status
   - Connection timeout: 2000ms
   - Query timeout: 2000ms

3. **Handle Failures**
   - If partition is unreachable:
     - Error is classified (RETRYABLE vs PERMANENT)
     - Write is queued in `missedWrites` array
     - Full context saved (query, params, timestamp, error)
     - User is NOT notified of replication failure

4. **User Experience**
   - ✓ User sees: **SUCCESS**
   - ✓ Data is persisted to Central Node
   - ✓ Reads from Central Node are immediately consistent
   - ⚠ Reads from failed partition may miss this record temporarily

#### Data Availability During Failure:

```
┌─────────────────────────────────────────────┐
│ USER REQUEST: Create User "John" (UK)      │
└─────────────────────────────────────────────┘
                    ↓
        ┌───────────────────────┐
        │   Central Node (0)    │ ← ✓ SUCCESS
        │   Write Committed     │
        └───────────────────────┘
                    ↓
        ┌───────────────────────┐
        │   Replication Phase   │
        └───────────────────────┘
         ↙                    ↘
┌─────────────────┐    ┌─────────────────┐
│  Partition 1    │    │  Partition 2    │
│  (M-Z)          │    │  (A-L)          │
│  ✓ SUCCESS      │    │  ✗ OFFLINE      │
└─────────────────┘    └─────────────────┘
                              ↓
                    ┌─────────────────┐
                    │ Queued for      │
                    │ Later Recovery  │
                    └─────────────────┘

RESULT: User sees SUCCESS
        Data readable from Central Node
        Partition 2 will sync when online
```

### Case #4: Partition Recovery After Missed Writes

**Scenario**: A previously offline Partition Node comes back online and needs to catch up with missed transactions.

#### Recovery Process:

1. **Health Check**
   - System detects node is back online
   - Connection test performed (1000ms timeout)
   - If healthy, recovery begins

2. **Queue Processing**
   - Missed writes processed in FIFO order
   - Each write includes:
     - Original SQL query
     - Parameters (firstname, lastname, city, country, timestamps)
     - Original timestamp (for consistency)
     - Previous attempt count
     - Last error message

3. **Duplicate Detection**
   ```sql
   SELECT id FROM users 
   WHERE firstname = ? AND lastname = ? 
     AND country = ? AND createdAt = ?
   ```
   - If record exists → Skip (already synchronized)
   - If not exists → Apply write

4. **Retry Logic**
   - **Retryable errors**: Connection timeout, deadlock
     - Retry up to 3 times
     - 500ms delay between retries
     - Keep in queue if all retries fail
   
   - **Permanent errors**: Duplicate entry, parse error
     - Do NOT retry
     - Remove from queue
     - Log for manual review

5. **Queue Management**
   - Successful writes: Removed from queue
   - Failed writes: Remain in queue with updated metadata
   - Attempt count incremented
   - Last error and timestamp recorded

#### Recovery Flow:

```
┌─────────────────────────────────────────────┐
│  Partition 2 Comes Back Online              │
└─────────────────────────────────────────────┘
                    ↓
        ┌───────────────────────┐
        │  Check Health Status  │ ← Ping test
        └───────────────────────┘
                    ↓
        ┌───────────────────────┐
        │  Load Missed Writes   │
        │  From Queue           │
        │  (e.g., 5 writes)     │
        └───────────────────────┘
                    ↓
    ┌─────────────────────────────────┐
    │ For Each Write:                 │
    │ 1. Check if already exists      │
    │ 2. Apply write with retries     │
    │ 3. Update queue status          │
    └─────────────────────────────────┘
                    ↓
        ┌───────────────────────┐
        │  Recovery Complete    │
        │  ✓ 4 applied          │
        │  ⚠ 1 failed (retry)   │
        └───────────────────────┘
```

## How Users Are Shielded from Node Failures

### 1. **Write Operations (Case #3)**
- **User Perspective**: Transaction appears successful
- **Behind the Scenes**: 
  - Data committed to Central Node
  - Replication failures are transparent
  - Queued for background recovery
  
### 2. **Read Operations**
- **Primary Strategy**: Read from Central Node
  - Always has complete, consistent data
  - No impact from partition failures
  
- **Partition Reads** (optimization):
  - May miss recent records during failure
  - Falls back to Central Node if partition fails
  - Eventual consistency maintained

### 3. **Concurrent Transactions**
- Multiple users can write simultaneously
- Each write is independent
- Partition failures don't block other transactions
- All successful writes to Central Node remain accessible

## Background Recovery Monitor

### Purpose
Automatically detect recovered nodes and apply missed writes without manual intervention.

### How It Works:
```javascript
// Runs every 30 seconds (configurable)
setInterval(async () => {
    for each partition:
        if (has missed writes):
            check health status
            if (healthy):
                apply missed writes
                update queue
}, 30000);
```

### Features:
- **Automatic Detection**: Checks node health periodically
- **Non-blocking**: Runs in background
- **Incremental Recovery**: Processes writes as nodes recover
- **Statistics Tracking**: 
  - Total checks performed
  - Total recoveries executed
  - Last recovery timestamp

## Data Replication Strategy

### Write Path:
1. **Write to Central Node** (Primary)
   - BEGIN TRANSACTION
   - INSERT/UPDATE data
   - COMMIT
   - Return success to user

2. **Replicate to Partitions** (Secondary)
   - Determine target partition(s)
   - Attempt write with timeout
   - If fails: Queue for later
   - If succeeds: Remove from queue

### Consistency Guarantees:

| Scenario | Consistency Level | User Impact |
|----------|------------------|-------------|
| All nodes healthy | **Strong Consistency** | Immediate consistency everywhere |
| Partition offline | **Eventual Consistency** | Central Node consistent, partition pending |
| Recovery in progress | **Converging** | Gradually achieving full consistency |
| Recovery complete | **Strong Consistency** | All nodes synchronized |

## What Happens During Recovery

### Phase 1: Detection
```
[Monitor] Check #42 at 2024-12-02T10:30:00Z
[Monitor] Partition 2: 5 pending writes
[Monitor] Partition 2: Online - attempting recovery...
```

### Phase 2: Processing
```
[Write 1/5] Processing...
  User: case3_first case3_last (UK)
  Original Timestamp: 2024-12-02 10:25:00
  Previous Attempts: 1
  ✓ RECOVERED - Write applied successfully

[Write 2/5] Processing...
  User: John Doe (Canada)
  ⚠ Record already exists (ID: 1523)
  → Skipping duplicate write
```

### Phase 3: Summary
```
[PARTITION 2] Recovery Summary:
  Total Processed: 5
  ✓ Successful: 4
  ⚠ Skipped (Duplicates): 1
  ✗ Failed: 0
  Remaining in Queue: 0
```

## Error Classification

### Retryable Errors:
- `ETIMEDOUT` - Connection timeout
- `ECONNREFUSED` - Connection refused
- `ECONNRESET` - Connection reset
- `PROTOCOL_CONNECTION_LOST` - Lost connection
- `ER_LOCK_DEADLOCK` - Deadlock detected
- `ER_LOCK_WAIT_TIMEOUT` - Lock wait timeout

**Action**: Retry up to 3 times with 500ms delay

### Permanent Errors:
- `ER_DUP_ENTRY` - Duplicate entry (record exists)
- `ER_NO_REFERENCED_ROW` - Foreign key violation
- `ER_ACCESS_DENIED_ERROR` - Permission denied
- `ER_BAD_DB_ERROR` - Database doesn't exist
- `ER_PARSE_ERROR` - SQL syntax error

**Action**: Do NOT retry, remove from queue, log for manual review

## Testing the System

### Test Scenario 1: Simulate Failure
```javascript
// 1. Turn off Partition 2
toggleNode(2);  // Sets node to OFFLINE

// 2. Run Case #3
runCase3();  // Writes to Central, fails on Partition 2

// 3. Check queue
// Queue for Partition 2: 1 write pending
```

### Test Scenario 2: Recovery
```javascript
// 1. Turn on Partition 2
toggleNode(2);  // Sets node back ONLINE

// 2. Run Case #4
runCase4();  // Applies missed writes

// 3. Verify synchronization
// Queue for Partition 2: 0 writes (synchronized)
```

### Test Scenario 3: Concurrent Transactions
```javascript
// 1. Turn off Partition 2
toggleNode(2);

// 2. Run concurrent test
runConcurrentTest();  // Simulates 5 users writing simultaneously

// Result: All 5 transactions succeed (Central Node)
//         5 writes queued for Partition 2
```

## Performance Considerations

### Timeouts:
- **Connection Timeout**: 2000ms
- **Query Timeout**: 2000ms
- **Health Check Timeout**: 1000ms

### Recovery Settings:
- **Check Interval**: 30000ms (30 seconds)
- **Max Retries**: 3 attempts
- **Retry Delay**: 500ms

### Queue Management:
- In-memory storage (persists during application runtime)
- Automatic cleanup after successful recovery
- Failed writes retained for manual review

## Monitoring & Observability

### Key Metrics:
1. **Queue Size**: Number of pending writes per node
2. **Recovery Rate**: Writes recovered per check cycle
3. **Failure Rate**: Percentage of writes that fail
4. **Health Status**: Current status of each node

### Dashboard Features:
- Real-time queue status
- Node health indicators
- Recovery monitor status
- Detailed event logs
- Manual recovery triggers

## Best Practices

### For Administrators:
1. **Monitor Queue Sizes**: Regularly check for growing queues
2. **Enable Background Monitor**: Keep automatic recovery running
3. **Review Failed Writes**: Check logs for permanent errors
4. **Test Regularly**: Simulate failures to verify recovery

### For Developers:
1. **Always Write to Central First**: Ensures data persistence
2. **Handle Errors Gracefully**: Don't expose replication failures to users
3. **Use Appropriate Timeouts**: Balance responsiveness and reliability
4. **Log Everything**: Comprehensive logging aids troubleshooting

## Limitations & Future Improvements

### Current Limitations:
- Queue is in-memory (lost on application restart)
- Manual intervention needed for permanent errors
- No automatic conflict resolution for concurrent updates

### Planned Improvements:
- Persistent queue (database or file-based)
- Automatic conflict resolution strategies
- Real-time monitoring dashboard
- Configurable retry policies
- Multi-master replication support

---

## Quick Reference

### Running Test Cases:

```javascript
// Case #3: Simulate replication failure
runCase3();

// Case #4: Recover failed node
runCase4();

// Start automatic recovery
startMonitor();

// Stop automatic recovery
stopMonitor();

// Check queue status
refreshQueueStatus();
```

### Expected Results:

**Case #3 (Success Scenario)**:
- Central write: ✓ SUCCESS
- Partition 1: ✓ SUCCESS (if online)
- Partition 2: ✓ SUCCESS (if online)
- Queue: 0 pending writes

**Case #3 (Failure Scenario)**:
- Central write: ✓ SUCCESS
- Partition 2: ✗ FAILED (offline)
- Queue: 1 write queued for Partition 2
- User experience: **SUCCESS** (shielded from failure)

**Case #4 (Recovery)**:
- Partition 2: ✓ ONLINE
- Processed: 1 write
- Applied: 1 write
- Queue: 0 pending writes
- Status: **FULLY SYNCHRONIZED**

---

**Document Version**: 1.0  
**Last Updated**: December 2, 2024  
**Authors**: STADVDB MCO2 Development Team
