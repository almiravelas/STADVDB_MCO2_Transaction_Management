class db_access {
    
    // Find by ID
    static async findById(connection, id) {
        const [rows] = await connection.execute(
            'SELECT * FROM Users WHERE id = ?', 
            [id]
        );
        return rows[0];
    }

    // Find by Country
    static async findByCountry(connection, country) {
        const [rows] = await connection.execute(
            'SELECT * FROM Users WHERE country = ? LIMIT 50', 
            [country]
        );
        return rows;
    }

    // Lock Row
    static async lockRow(connection, id) {
        await connection.query(
            'SELECT id FROM Users WHERE id = ? FOR UPDATE', 
            [id]
        );
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

        const sql = `UPDATE Users SET ${setClause} WHERE id = ?`;
        await connection.query(sql, values);
    }

    // Dynamic Insert
    static async insertUser(connection, data) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        
        // Create placeholders (?, ?, ?)
        const placeholders = keys.map(() => '?').join(', ');

        // Create the SQL: INSERT INTO Users (id, name, createdAt) VALUES (?, ?, ?)
        const sql = `INSERT INTO Users (${keys.join(', ')}) VALUES (${placeholders})`;
        
        // DEBUGGING: Print the SQL to the console to verify 'createdAt' is there
        console.log("EXECUTING SQL:", sql);
        console.log("VALUES:", values);

        const [result] = await connection.query(sql, values);
        return result.insertId;
    }

    // Delete
    static async deleteUser(connection, id) {
        await connection.query('DELETE FROM Users WHERE id = ?', [id]);
    }
}

module.exports = db_access;