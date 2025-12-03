class db_access {
    
    // =========================================================
    // ISOLATION LEVEL: REPEATABLE READ (Default for all transactions)
    // =========================================================
    static DEFAULT_ISOLATION = 'REPEATABLE READ';

    // Find by ID
    static async findById(connection, id) {
        const [rows] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
        return rows[0];
    }

    // Find by Country
    static async findByCountry(connection, country) {
        const [rows] = await connection.execute('SELECT * FROM users WHERE country LIKE ? LIMIT 50', [country]);
        return rows;
    }

    // =========================================================
    // PESSIMISTIC LOCKING: Exclusive lock on row
    // Uses SELECT ... FOR UPDATE to acquire exclusive lock
    // =========================================================
    static async lockRow(connection, id) {
        // Pessimistic lock - blocks other transactions until released
        const [rows] = await connection.query('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
        return rows[0];
    }

    /**
     * PESSIMISTIC LOCKING: Exclusive lock (FOR UPDATE)
     * - Blocks other transactions from reading/writing until released
     * - Used for: UPDATE, DELETE operations
     * - Prevents: Lost updates, dirty reads, non-repeatable reads
     */
    static async lockRowExclusive(connection, table, id) {
        const [rows] = await connection.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
        return rows[0];
    }

    /**
     * PESSIMISTIC LOCKING: Shared lock (LOCK IN SHARE MODE)
     * - Allows other transactions to read but not write
     * - Used for: Read operations that need consistency
     * - Prevents: Dirty reads, ensures data doesn't change during read
     */
    static async lockRowShared(connection, table, id) {
        const [rows] = await connection.query(`SELECT * FROM ${table} WHERE id = ? LOCK IN SHARE MODE`, [id]);
        return rows[0];
    }

    // Lock for ID generation (pessimistic lock on max ID)
    static async lockForNewId(connection) {
        // Lock the last row to prevent concurrent ID generation
        const [rows] = await connection.query(
            'SELECT id FROM users ORDER BY id DESC LIMIT 1 FOR UPDATE'
        );
        return rows.length ? rows[0].id : 0;
    }

    // =========================================================
    // ISOLATION LEVEL CONFIGURATION
    // Supports: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE
    // Default: REPEATABLE READ for ACID compliance
    // =========================================================
    static async setIsolationLevel(connection, level = 'REPEATABLE READ') {
        await connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${level}`);
    }

    // Dynamic Update
    static async updateUser(connection, id, data) {
        const keys = Object.keys(data);
        if (keys.length === 0) return;

        const setClause = keys.map(key => `${key} = ?`).join(', ');
        const values = Object.values(data);
        values.push(id); 

        await connection.query(`UPDATE users SET ${setClause} WHERE id = ?`, values);
    }

    // Dynamic Insert
    static async insertUser(connection, data) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map(() => '?').join(', ');

        const sql = `INSERT INTO users (${keys.join(', ')}) VALUES (${placeholders})`;
        const [result] = await connection.query(sql, values);
        return result.insertId;
    }

    // Delete
    static async deleteUser(connection, id) {
        const [result] = await connection.query('DELETE FROM users WHERE id = ?', [id]);
        return result;
    }

    // =========================================================
    // 2PC PREPARE PHASE: XA Transaction Support
    // =========================================================
    static async xaPrepare(connection, xid) {
        await connection.query(`XA END '${xid}'`);
        await connection.query(`XA PREPARE '${xid}'`);
    }

    static async xaCommit(connection, xid) {
        await connection.query(`XA COMMIT '${xid}'`);
    }

    static async xaRollback(connection, xid) {
        try {
            await connection.query(`XA ROLLBACK '${xid}'`);
        } catch (e) {
            // May fail if already rolled back
            console.log(`[XA] Rollback warning for ${xid}: ${e.message}`);
        }
    }

    static async xaStart(connection, xid) {
        await connection.query(`XA START '${xid}'`);
    }
}

module.exports = db_access;