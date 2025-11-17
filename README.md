# STADVDB_MCO2 – Transaction Management

This repository holds the project for the **STADVDB MCO2** course, focusing on **Transaction Management**.

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