# Quick Start Guide - Cases #3 & #4

## 🚀 Get Started in 5 Minutes

This guide will help you quickly test the failure recovery system.

## Prerequisites

✓ Application running on `http://localhost:3000`  
✓ All 3 database nodes accessible  
✓ Browser open to the application  

## Step 1: Navigate to Failure Recovery Dashboard

```
1. Open browser: http://localhost:3000
2. Click on "Failure Recovery" in sidebar
3. You should see:
   - 3 node status cards (all green "ONLINE")
   - Background Recovery Monitor panel
   - 4 test case buttons
   - Event log at bottom
```

## Step 2: Test Case #3 (Replication Failure)

**What it demonstrates**: System handles partition failure gracefully

### Actions:
```
1. Click "Toggle" on Partition 2 (Node 2)
   → Status changes to "OFFLINE" (red)

2. Click "Run" button under Case #3
   → Watch the event log fill with details

3. Look for these key lines in the log:
   ✓ CENTRAL write SUCCESS.
   ✗ Replication to Partition 2 FAILED
   → Write queued for later recovery
   → Queue size for Partition 2: 1

4. Check queue indicator on Partition 2 card
   → Should show "Queue: 1" in red
```

### Expected Result:
- ✅ Transaction succeeds (user would see success)
- ✅ Data written to Central Node
- ✅ Write queued for Partition 2
- ✅ System continues operating normally

## Step 3: Test Case #4 (Recovery)

**What it demonstrates**: Automatic recovery when node comes back

### Actions:
```
1. Click "Toggle" on Partition 2 again
   → Status changes to "ONLINE" (green)
   → Queue still shows "1" (not yet recovered)

2. Click "Run" button under Case #4
   → Watch recovery process in log

3. Look for these key lines:
   [Write 1/1] Processing...
   ✓ RECOVERED - Write applied successfully
   Remaining in Queue: 0

4. Check queue indicator
   → Should show "Queue: 0" back to orange
```

### Expected Result:
- ✅ Node detected as healthy
- ✅ Queued write applied successfully
- ✅ Queue cleared
- ✅ System fully synchronized

## Step 4: Test Concurrent Transactions

**What it demonstrates**: Multiple users protected from failures

### Actions:
```
1. Keep Partition 2 OFFLINE
2. Set "Transaction Count": 5
3. Set "Delay": 500ms
4. Click "Run Concurrent Test"

Watch the log:
[Transaction 1] Started...
[Transaction 2] Started...
...
[Transaction 1] ✓ COMPLETED
[Transaction 2] ✓ COMPLETED
...
Queue: 6 (1 from before + 5 new)
```

### Expected Result:
- ✅ All 5 transactions succeed
- ✅ All writes commit to Central
- ✅ 5 writes queued for Partition 2
- ✅ No user errors or blocking

## Step 5: Test Background Monitor

**What it demonstrates**: Automatic recovery without manual action

### Actions:
```
1. Click "Start Monitor" button
   → Status shows "RUNNING" (green)
   → Monitor details appear

2. Turn Partition 2 OFFLINE
3. Run Case #3 2-3 times
   → Queue builds up (2-3 writes)

4. Turn Partition 2 ONLINE
5. Wait ~30 seconds
6. Click "Refresh Status"
   → Queue automatically cleared!
   → Monitor shows recovery stats

7. Click "Stop Monitor" when done
```

### Expected Result:
- ✅ Monitor runs in background
- ✅ Automatic recovery on next cycle
- ✅ No manual Case #4 needed
- ✅ Statistics tracked

## Quick Troubleshooting

### Problem: Node won't go offline
**Solution**: The toggle simulates application-level failure. It doesn't actually stop the database.

### Problem: Queue not clearing
**Solution**: 
- Verify node is truly ONLINE (green)
- Click "Refresh Queue" button
- Check event log for errors
- Try running Case #4 manually

### Problem: No logs appearing
**Solution**:
- Check browser console for JavaScript errors
- Refresh the page
- Verify server is running

## Visual Indicators Explained

### Node Status Colors
- 🟢 **Green "ONLINE"**: Node is healthy
- 🔴 **Red "OFFLINE"**: Node is down (simulated)

### Queue Indicators
- 🟠 **Orange "Queue: 0"**: No pending writes
- 🔴 **Red "Queue: 5"**: Pending writes need recovery

### Monitor Status
- 🟢 **Green "RUNNING"**: Auto-recovery enabled
- 🔴 **Red "STOPPED"**: Manual recovery only

## Expected Console Output

When running Case #3 with failure:
```
========================================
CASE #3: Central → Partition Replication Failure
========================================

[PHASE 1] Attempting to write to CENTRAL NODE...
✓ CENTRAL write SUCCESS.
  Transaction ID: 2024-12-02 10:30:00
  User: case3_first case3_last (UK)

[PHASE 2] Replicating to PARTITION NODES...

  → Attempting replication to Partition 1...
    ✓ Replication to Partition 1 SUCCESS.

  → Attempting replication to Partition 2...
    ✗ Replication to Partition 2 FAILED
      Error: Node 2 is unhealthy/unreachable
      Error Type: RETRYABLE (ECONNREFUSED)
      → Write queued for later recovery
      → Queue size for Partition 2: 1

========================================
REPLICATION SUMMARY:
  Central Node (0): ✓ SUCCESS
  Partition 1: ✓ SUCCESS
  Partition 2: ✗ FAILED (Queued)

USER IMPACT:
  ✓ Transaction COMMITTED - User sees success
  ✓ Data persisted to Central Node
  ⚠ Replication pending to: Partition 2
  → Background recovery will sync when nodes recover
========================================
```

When running Case #4 recovery:
```
========================================
CASE #4: Partition Recovery & Synchronization
========================================

[PARTITION 2] Checking recovery status...
  → Found 1 missed write(s) in queue
  ✓ Partition 2 is ONLINE and healthy
  → Beginning recovery process...

  [Write 1/1] Processing...
    User: case3_first case3_last (UK)
    Original Timestamp: 2024-12-02 10:30:00
    Previous Attempts: 1
    ✓ RECOVERED - Write applied successfully

[PARTITION 2] Recovery Summary:
  Total Processed: 1
  ✓ Successful: 1
  ✗ Failed: 0
  Remaining in Queue: 0

========================================
OVERALL RECOVERY SUMMARY:
  Total Writes Attempted: 1
  Total Successful: 1
  Total Failed: 0

CURRENT QUEUE STATUS:
  Partition 1: 0 pending write(s)
  Partition 2: 0 pending write(s)

✓ SYSTEM STATUS: All partitions synchronized
✓ CONSISTENCY: Full consistency achieved
========================================
```

## Success Checklist

After completing the quick start, you should have:

- [x] Successfully simulated a node failure
- [x] Observed write queuing in Case #3
- [x] Recovered queued writes in Case #4
- [x] Tested concurrent transactions
- [x] Enabled background monitor
- [x] Verified automatic recovery
- [x] Understood the event logs
- [x] Seen queue management in action

## Next Steps

1. **Read Full Documentation**:
   - `RECOVERY_STRATEGY.md` - Architecture details
   - `TESTING_GUIDE.md` - Comprehensive tests
   - `DEPLOYMENT_GUIDE.md` - Demo script

2. **Try Advanced Scenarios**:
   - Multiple node failures
   - High transaction volumes
   - Edge cases

3. **Prepare Demonstration**:
   - Practice the flow
   - Understand talking points
   - Review Q&A

## Key Talking Points for Demo

When demonstrating to others, emphasize:

1. **User Protection**: "Users never see replication failures - they always get success"
2. **Automatic Recovery**: "System fixes itself when nodes come back online"
3. **No Data Loss**: "Everything queued and eventually consistent"
4. **Zero Downtime**: "Application keeps running during failures"

## Common Demo Flow

```
1. Show all nodes healthy (2 min)
2. Simulate failure with Case #3 (3 min)
3. Show concurrent transactions work (2 min)
4. Recover with Case #4 (2 min)
5. Demo background monitor (2 min)
6. Q&A (5 min)

Total: ~15 minutes
```

---

**Time to Complete**: 5-10 minutes  
**Difficulty**: Easy  
**Prerequisites**: Running application + database access

**Ready to start?** Open `http://localhost:3000` and navigate to Failure Recovery! 🚀
