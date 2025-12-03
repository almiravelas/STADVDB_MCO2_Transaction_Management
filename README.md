# STADVDB_MCO2 – Transaction Management & Distributed Database Recovery

This repository holds the project for the **STADVDB MCO2** course, focusing on **Transaction Management** and **Distributed Database Failure Recovery**.

## 🎯 Project Overview

This web application demonstrates a distributed database system with:
- **3-node architecture**: 1 Central Node + 2 Partition Nodes
- **Automatic failure detection and recovery**
- **User shielding from node failures**
- **Eventual consistency guarantees**
- **Real-time monitoring and visualization**

### Key Features

#### Case #3: Central → Partition Replication Failure
When a write succeeds on the Central Node but fails to replicate to partitions:
- ✓ User sees SUCCESS (shielded from failure)
- ✓ Write queued automatically for later recovery
- ✓ System continues operating normally
- ✓ Data readable from Central Node immediately

#### Case #4: Partition Recovery
When a failed partition comes back online:
- ✓ Automatic detection of node recovery
- ✓ Intelligent replay of missed writes
- ✓ Duplicate detection and handling
- ✓ Retry logic with error classification
- ✓ Eventual consistency achieved

#### Background Recovery Monitor
- ✓ Automatic periodic health checks (30s intervals)
- ✓ Non-blocking background processing
- ✓ Real-time statistics tracking
- ✓ No manual intervention required

#### Enhanced Monitoring Dashboard
- Real-time queue status for all nodes
- Node health indicators (ONLINE/OFFLINE)
- Concurrent transaction simulation
- Detailed event logging
- Recovery statistics

## 📚 Documentation

Comprehensive documentation available:
- **[RECOVERY_STRATEGY.md](./RECOVERY_STRATEGY.md)** - Detailed architecture and recovery strategy
- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** - Step-by-step testing procedures
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Deployment and demonstration instructions

The `db/` folder contains a Python script (`test_db.py`) used to verify the connection to the CCS Cloud MySQL node and confirm the database is reachable.

---

## 📋 Prerequisites

Before running the test script, ensure both the server and your local machine are ready.

### 1. Server-Side (Proxmox VM)

The MySQL database is hosted on a Proxmox VM. You must ensure it's running first.

1.  Log in to **Proxmox**.
2.  Find our group's VM (Check the shared documentation for the **VM ID and name**).
3.  Ensure the VM status is **running**.
    > If the VM is powered off, start it first.
4.  From the shared doc, note the following credentials:
    * MySQL Port
    * Database Name
    * Database User & Password

---

## ⚙️ Local Setup & Testing

Follow these steps from your local machine's terminal.

1.  **Navigate to the `db` directory:**
python -m venv venv

2.  **Activate the virtual environment:**

    * **Windows (PowerShell):**
        .\venv\Scripts\Activate.ps1
        *(See the troubleshooting section below if this fails.)*

4.  **Install the required packages:**
    pip install -r requirements.txt

5.  **Run the connection test script:**
    python test_db.py

✅ **Success:** If everything is configured correctly, the terminal should display the sample rows fetched from the database.

---

## ⚠️ Troubleshooting

### PowerShell Execution Policy Error

If you see an error like `...cannot be loaded because running scripts is disabled on this system...`, your execution policy is blocking the activation script.

To fix this, run the following command **once** to allow scripts for your user account:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned