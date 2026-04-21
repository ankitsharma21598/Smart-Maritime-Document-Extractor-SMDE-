import "dotenv/config";

if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { sequelize } = await import("../models/index.js");

await sequelize.query(`
  TRUNCATE TABLE
    session_validations,
    jobs,
    documents,
    extraction_cache,
    sessions
  RESTART IDENTITY CASCADE;
`);

console.log("Deleted all rows from sessions, extraction_cache, documents, jobs, session_validations.");
await sequelize.close();
