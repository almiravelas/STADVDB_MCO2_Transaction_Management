const express = require("express");
const failureController = require("../controller/failureController.js");

const router = express.Router();

// Toggle node ON/OFF
router.post("/node/:id/off", failureController.nodeOff);
router.post("/node/:id/on", failureController.nodeOn);

// Replication test cases
router.post("/case1", failureController.testCase1);
router.post("/case2", failureController.testCase2);
router.post("/case3", failureController.testCase3);
router.post("/case4", failureController.testCase4);

// Recovery monitor controls
router.post("/monitor/start", failureController.startRecoveryMonitor);
router.post("/monitor/stop", failureController.stopRecoveryMonitor);
router.get("/monitor/status", failureController.getRecoveryMonitorStatus);
router.get("/queue/status", failureController.getQueueStatus);
router.get("/system/health", failureController.getSystemHealth);

// Manual recovery trigger
router.post("/recover/now", failureController.triggerRecoveryNow);

module.exports = router;
