// Run a SQL migration file against the database
// Usage: node scripts/run_migration.js <path_to_sql_file>
const { Client } = require("pg");
const { readFileSync } = require("fs");

const dbUrl = process.env.DATABASE_URL || process.argv[3];
const sqlFile = process.argv[2];

if (!sqlFile) {
  console.error("Usage: node scripts/run_migration.js <sql_file> [db_url]");
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString:
      dbUrl ||
      "postgresql://postgres.nhqxhntueexrzpyldvee:EAcUkDOXUM19stB7@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected. Running:", sqlFile);

  const sql = readFileSync(sqlFile, "utf-8");
  try {
    await client.query(sql);
    console.log("Migration applied successfully.");
  } catch (err) {
    console.error("Migration error:", err.message);
    if (err.position) {
      const lines = sql.slice(0, parseInt(err.position)).split("\n");
      console.error(`  Near line ${lines.length}: ${lines[lines.length - 1].trim()}`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
