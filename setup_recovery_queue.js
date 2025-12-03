const mysql = require('mysql2/promise');
require('dotenv').config();

async function createRecoveryQueueTable() {
    const conn = await mysql.createConnection({
        host: process.env.NODE0_HOST,
        port: parseInt(process.env.NODE0_PORT),
        user: process.env.NODE0_USER,
        password: process.env.NODE0_PASSWORD,
        database: process.env.NODE0_DB
    });

    const sql = `
        CREATE TABLE IF NOT EXISTS recovery_queue (
            id INT AUTO_INCREMENT PRIMARY KEY,
            target_partition INT NOT NULL COMMENT '1 = Partition 1 (M-Z), 2 = Partition 2 (A-L)',
            user_id INT NOT NULL COMMENT 'The user ID being inserted',
            query_text TEXT NOT NULL COMMENT 'The SQL query to execute',
            params_json TEXT NOT NULL COMMENT 'JSON array of query parameters',
            attempt_count INT DEFAULT 1,
            last_error TEXT,
            error_type VARCHAR(50),
            queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_attempt_at DATETIME NULL,
            status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
            INDEX idx_partition_status (target_partition, status),
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    await conn.execute(sql);
    console.log('✓ recovery_queue table created on Central node!');
    
    // Verify
    const [rows] = await conn.execute('DESCRIBE recovery_queue');
    console.log('Table structure:', rows.map(r => r.Field).join(', '));
    
    await conn.end();
}

createRecoveryQueueTable().catch(e => console.error('Error:', e.message));
