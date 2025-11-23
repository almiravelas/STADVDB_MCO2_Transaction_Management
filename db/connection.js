require('dotenv').config();
const mysql = require('mysql2/promise');

const createConfig = (host, port, user, password, database) => ({
  host: host,
  port: Number(port),
  user: user,
  password: password,
  database: database,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 0
});

const node0Pool = mysql.createPool(createConfig(
  process.env.NODE0_HOST,
  process.env.NODE0_PORT,
  process.env.NODE0_USER,
  process.env.NODE0_PASSWORD,
  process.env.NODE0_DB
));

const node1Pool = mysql.createPool(createConfig(
  process.env.NODE1_HOST,
  process.env.NODE1_PORT,
  process.env.NODE1_USER,
  process.env.NODE1_PASSWORD,
  process.env.NODE1_DB
));

const node2Pool = mysql.createPool(createConfig(
  process.env.NODE2_HOST,
  process.env.NODE2_PORT,
  process.env.NODE2_USER,
  process.env.NODE2_PASSWORD,
  process.env.NODE2_DB
));

module.exports = {
  node0: node0Pool,
  node1: node1Pool,
  node2: node2Pool
};