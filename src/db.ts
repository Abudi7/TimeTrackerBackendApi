import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const {
  MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE,
  DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
} = process.env;

export const pool = mysql.createPool({
  host: MYSQLHOST || DB_HOST,               // لا تتركه فارغًا
  port: Number(MYSQLPORT || DB_PORT || 3306),
  user: MYSQLUSER || DB_USER,
  password: MYSQLPASSWORD || DB_PASS,
  database: MYSQLDATABASE || DB_NAME,
  connectionLimit: 10,
  // إن كنت تستخدم مزوّدًا خارجيًا يفرض SSL (اختياري):
  // ssl: { rejectUnauthorized: true },
});
