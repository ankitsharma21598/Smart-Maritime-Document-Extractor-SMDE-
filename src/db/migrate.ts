import { sequelize } from "../models/index.js";

export async function migrate(): Promise<void> {
  await sequelize.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await sequelize.sync();

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_extract_per_hash
    ON jobs (file_hash)
    WHERE kind = 'extract' AND status IN ('queued', 'running');
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_jobs_queued ON jobs(created_at)
    WHERE status = 'queued';
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash);
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_session_validations_session ON session_validations(session_id);
  `);

  await sequelize.query(`
    ALTER TABLE extraction_cache
    ADD COLUMN IF NOT EXISTS raw_llm_response TEXT;
  `);

  await sequelize.query(`
    ALTER TABLE extraction_cache
    ADD COLUMN IF NOT EXISTS document_name TEXT,
    ADD COLUMN IF NOT EXISTS applicable_role TEXT,
    ADD COLUMN IF NOT EXISTS confidence TEXT,
    ADD COLUMN IF NOT EXISTS holder_name TEXT,
    ADD COLUMN IF NOT EXISTS date_of_birth TEXT,
    ADD COLUMN IF NOT EXISTS sirb_number TEXT,
    ADD COLUMN IF NOT EXISTS passport_number TEXT,
    ADD COLUMN IF NOT EXISTS is_expired BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER,
    ADD COLUMN IF NOT EXISTS error_code TEXT;
  `);

  await sequelize.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS error_code TEXT;
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_session_hash_unique
    ON documents(session_id, file_hash);
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_jobs_session_status ON jobs(session_id, status);
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_extraction_cache_type_role
    ON extraction_cache(document_type, applicable_role);
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_extraction_cache_identity
    ON extraction_cache(holder_name, sirb_number, passport_number);
  `);
}
