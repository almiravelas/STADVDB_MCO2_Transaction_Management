class db_access {
    
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

    // Lock Row
    static async lockRow(connection, id) {
        await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
    }

    //Isolation levels: 'READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'
    static async setIsolationLevel(connection, level) {
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
}

module.exports = db_access;