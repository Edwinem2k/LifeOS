// Runs seed.sql with a fixed user_id placeholder replaced
const { Client } = require("pg");
const { readFileSync } = require("fs");

const UID = process.env.LIFE_OS_USER_ID || "00000000-0000-0000-0000-000000000001";

async function main() {
  const client = new Client({
    connectionString:
      "postgresql://postgres.nhqxhntueexrzpyldvee:EAcUkDOXUM19stB7@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected. Seeding with user_id:", UID);

  let sql = readFileSync("scripts/seed.sql", "utf-8");

  // Remove psql-specific \set line
  sql = sql.replace(/\\set\s+uid\s+.*/g, "");
  // Replace :uid with the actual UUID string
  sql = sql.replace(/:uid/g, `'${UID}'`);

  try {
    await client.query(sql);
    console.log("Seed data inserted successfully.");
  } catch (err) {
    console.error("Seed error:", err.message);
    if (err.position) {
      const lines = sql.slice(0, parseInt(err.position)).split("\n");
      console.error(`  Near line ${lines.length}: ${lines[lines.length - 1].trim()}`);
    }
  } finally {
    await client.end();
  }
}

main();
