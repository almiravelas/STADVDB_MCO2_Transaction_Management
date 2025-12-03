# Testing Guide: Distributed Database Failure Recovery

This guide provides step-by-step instructions for testing the global crash and recovery scenarios.

## Prerequisites

1. All three database nodes should be running and accessible
2. Web application should be deployed and running
3. Access to the Failure Recovery Simulator dashboard

## Test Suite 1: Case #3 - Replication Failure

### Objective
Demonstrate how the system handles write failures when replicating from Central Node to Partition Nodes.

### Steps:

#### 1. Verify Initial State
```
1. Navigate to Failure Recovery section
2. Check all nodes show "ONLINE"
3. Verify queue counts are at 0 for all nodes
```

#### 2. Simulate Partition Failure
```
1. Click "Toggle" on Partition 2 (Node 2)
2. Observe status changes to "OFFLINE" (red)
3. Event log shows: "Node 2 is now OFFLINE."
```

#### 3. Execute Case #3
```
1. Click "Run" button under Case #3
2. Observe the detailed logs:
   ========================================
   CASE #3: Central → Partition Replication Failure
   ========================================
   
   [PHASE 1] Attempting to write to CENTRAL NODE...
   ✓ CENTRAL write SUCCESS.
   
   [PHASE 2] Replicating to PARTITION NODES...
   → Attempting replication to Partition 1...
     ✓ Replication to Partition 1 SUCCESS.
   
   → Attempting replication to Partition 2...
     ✗ Replication to Partition 2 FAILED
     Error: Node 2 is unhealthy/unreachable
     → Write queued for later recovery
     → Queue size for Partition 2: 1
```

#### 4. Verify Results
```
Expected Results:
✓ Central Node: Write successful
✓ Partition 1: Replicated successfully
✗ Partition 2: Failed (offline)
✓ Queue for Partition 2: 1 write pending
✓ User Experience: SUCCESS (shielded from failure)
```

#### 5. Test Multiple Concurrent Transactions
```
1. Leave Partition 2 offline
2. Set "Transaction Count" to 5
3. Set "Delay" to 500ms
4. Click "Run Concurrent Test"
5. Observe:
   - All 5 transactions complete successfully
   - Queue for Partition 2 increases to 6 writes
   - All users see SUCCESS messages
```

### Expected Outcomes:
- ✓ Users are NOT aware of partition failure
- ✓ All writes committed to Central Node
- ✓ Failed writes queued for recovery
- ✓ System continues to operate normally

---

## Test Suite 2: Case #4 - Partition Recovery

### Objective
Demonstrate how the system recovers when a failed partition comes back online.

### Steps:

#### 1. Verify Failure State
```
1. Ensure Partition 2 is OFFLINE (from previous test)
2. Verify queue shows pending writes (e.g., 6 writes)
3. Queue indicator should be red
```

#### 2. Bring Node Back Online
```
1. Click "Toggle" on Partition 2
2. Observe status changes to "ONLINE" (green)
3. Event log shows: "Node 2 is now ONLINE."
4. Queue count still shows 6 (not yet recovered)
```

#### 3. Execute Case #4
```
1. Click "Run" button under Case #4
2. Observe detailed recovery logs:
   ========================================
   CASE #4: Partition Recovery & Synchronization
   ========================================
   
   [PARTITION 2] Checking recovery status...
   → Found 6 missed write(s) in queue
   ✓ Partition 2 is ONLINE and healthy
   → Beginning recovery process...
   
   [Write 1/6] Processing...
     User: case3_first case3_last (UK)
     Original Timestamp: 2024-12-02 10:25:00
     Previous Attempts: 1
     ✓ RECOVERED - Write applied successfully
   
   [Write 2/6] Processing...
     [... similar for each write ...]
   
   [PARTITION 2] Recovery Summary:
     Total Processed: 6
     ✓ Successful: 6
     ✗ Failed: 0
     Remaining in Queue: 0
```

#### 4. Verify Results
```
Expected Results:
✓ All 6 writes recovered successfully
✓ Queue for Partition 2: 0 writes
✓ System status: FULLY SYNCHRONIZED
✓ Partition 2 now has all data
```

#### 5. Verify Data Consistency
```
1. Query Central Node for recent records
2. Query Partition 2 for same records
3. Confirm data matches exactly
4. Check timestamps are preserved
```

### Expected Outcomes:
- ✓ All missed writes successfully applied
- ✓ No data loss occurred
- ✓ Timestamps preserved from original writes
- ✓ System achieves eventual consistency

---

## Test Suite 3: Background Recovery Monitor

### Objective
Test automatic recovery without manual intervention.

### Steps:

#### 1. Enable Background Monitor
```
1. Click "Start Monitor" button
2. Observe:
   - Status changes to "RUNNING" (green)
   - Monitor details appear
   - Event log shows: "[Monitor] Recovery monitor started"
```

#### 2. Simulate Failure During Monitor
```
1. Turn Partition 2 OFFLINE
2. Click "Run" under Case #3 (3-5 times)
3. Observe queue building up (e.g., 3 writes queued)
4. Monitor is still running in background
```

#### 3. Recovery Without Manual Intervention
```
1. Turn Partition 2 ONLINE
2. Wait for monitor cycle (30 seconds)
3. Observe console/event log:
   [Monitor] Check #X at [timestamp]
   [Monitor] Partition 2: 3 pending writes
   [Monitor] Partition 2: Online - attempting recovery...
   [Monitor] Recovered: case3_first case3_last
   [Monitor] Partition 2: Recovered 3 writes, 0 remaining
```

#### 4. Verify Auto-Recovery
```
Expected Results:
✓ Monitor automatically detected node recovery
✓ Writes applied without clicking Case #4
✓ Queue automatically cleared
✓ Recovery stats updated
```

#### 5. Stop Monitor
```
1. Click "Stop Monitor" button
2. Status changes to "STOPPED" (red)
3. Monitor details hide
```

### Expected Outcomes:
- ✓ Automatic recovery works without user action
- ✓ Monitor tracks statistics correctly
- ✓ System achieves consistency autonomously

---

## Test Suite 4: Edge Cases & Error Handling

### Test 4.1: Duplicate Detection
```
Scenario: Same write queued multiple times

Steps:
1. Turn Partition 2 OFFLINE
2. Run Case #3 multiple times (same data)
3. Turn Partition 2 ONLINE
4. Run Case #4

Expected:
✓ Only first write applied
⚠ Subsequent writes detected as duplicates
✓ Skipped gracefully with log message
```

### Test 4.2: Permanent Errors
```
Scenario: Write fails with permanent error (e.g., invalid data)

Steps:
1. Manually add invalid write to queue (via code)
2. Run Case #4

Expected:
✗ Write fails permanently
✓ Removed from queue (not retried)
✓ Logged for manual review
```

### Test 4.3: Partial Recovery
```
Scenario: Some writes succeed, others fail

Steps:
1. Queue multiple writes (valid and invalid)
2. Run Case #4

Expected:
✓ Valid writes applied successfully
✗ Invalid writes remain in queue or removed
✓ Summary shows both success and failure counts
```

### Test 4.4: Multiple Node Failures
```
Scenario: Both partitions fail simultaneously

Steps:
1. Turn BOTH Partition 1 and 2 OFFLINE
2. Run Case #3 multiple times
3. Verify queues for both partitions

Expected:
✓ Writes succeed on Central Node
✗ Both partitions fail
✓ Writes queued for both nodes
```

### Test 4.5: Recovery While Offline
```
Scenario: Attempt recovery while node still offline

Steps:
1. Turn Partition 2 OFFLINE
2. Run Case #3 to queue writes
3. Run Case #4 (without bringing node online)

Expected:
⚠ Recovery skipped
✓ Writes remain in queue
✓ Message: "Partition still OFFLINE/UNREACHABLE"
```

---

## Test Suite 5: Performance & Stress Testing

### Test 5.1: High Volume Concurrent Writes
```
Steps:
1. Turn Partition 2 OFFLINE
2. Set Transaction Count: 20
3. Set Delay: 100ms
4. Run Concurrent Test

Expected:
✓ All 20 transactions succeed
✓ 20 writes queued for Partition 2
✓ System remains responsive
✓ No blocking or deadlocks
```

### Test 5.2: Recovery Performance
```
Steps:
1. Queue 50+ writes (run Case #3 many times)
2. Turn node ONLINE
3. Run Case #4
4. Measure recovery time

Expected:
✓ Recovery completes in reasonable time
✓ Progress shown in logs
✓ No timeouts or failures
```

### Test 5.3: Monitor Under Load
```
Steps:
1. Start Background Monitor
2. Continuously fail/recover nodes
3. Monitor for 5+ minutes

Expected:
✓ Monitor continues to function
✓ No memory leaks
✓ Stats accurately tracked
```

---

## Verification Checklist

After completing all tests, verify:

### Data Integrity
- [ ] All writes persisted to Central Node
- [ ] Recovered data matches original timestamps
- [ ] No duplicate records created
- [ ] No data loss occurred

### System Behavior
- [ ] Users never see replication failures
- [ ] Reads always return data (from Central)
- [ ] Writes never blocked by partition failures
- [ ] Recovery completes automatically

### Monitoring
- [ ] Queue sizes accurate
- [ ] Node health status correct
- [ ] Recovery stats tracked properly
- [ ] Event logs comprehensive

### Error Handling
- [ ] Timeouts handled gracefully
- [ ] Retryable errors retried
- [ ] Permanent errors not retried
- [ ] Errors logged with context

---

## Troubleshooting

### Issue: Queue Not Clearing
**Symptoms**: Case #4 runs but queue remains full
**Solutions**:
1. Check node is truly ONLINE (health check)
2. Review error logs for specific failures
3. Verify database permissions
4. Check network connectivity

### Issue: Monitor Not Running
**Symptoms**: Monitor status shows STOPPED but should be RUNNING
**Solutions**:
1. Click "Stop Monitor" then "Start Monitor"
2. Check browser console for errors
3. Verify server connection
4. Restart application if needed

### Issue: Writes Failing on Central Node
**Symptoms**: Case #3 fails at Phase 1
**Solutions**:
1. Check Central Node is accessible
2. Verify database credentials
3. Check database disk space
4. Review connection pool settings

---

## Success Criteria

A successful test run demonstrates:

1. **Failure Tolerance**
   - ✓ System operates during partition failures
   - ✓ Users experience no interruptions
   - ✓ Data remains accessible

2. **Recovery Capability**
   - ✓ Failed nodes recover automatically
   - ✓ Missed writes successfully applied
   - ✓ Data consistency achieved

3. **Monitoring & Observability**
   - ✓ Real-time status visibility
   - ✓ Comprehensive event logging
   - ✓ Accurate metrics and stats

4. **User Experience**
   - ✓ Fast response times
   - ✓ Transparent failure handling
   - ✓ No visible errors or inconsistencies

---

## Reporting Results

Document your test results using this template:

```markdown
# Test Results - [Date]

## Environment
- Central Node: [IP/Status]
- Partition 1: [IP/Status]
- Partition 2: [IP/Status]

## Test Case #3 Results
- Executions: [Count]
- Success Rate: [%]
- Writes Queued: [Count]
- User Impact: [None/Minimal/Significant]

## Test Case #4 Results
- Recovery Attempts: [Count]
- Success Rate: [%]
- Average Recovery Time: [ms]
- Data Consistency: [Verified/Issues]

## Background Monitor Results
- Total Checks: [Count]
- Total Recoveries: [Count]
- Uptime: [Duration]
- Issues Encountered: [None/List]

## Issues & Observations
[Describe any issues, unexpected behavior, or notable observations]

## Recommendations
[List any recommendations for improvement]
```

---

**Document Version**: 1.0  
**Last Updated**: December 2, 2024
