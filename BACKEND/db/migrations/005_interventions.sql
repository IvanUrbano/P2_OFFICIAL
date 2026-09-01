-- 005_interventions.sql
-- Intervention & Action Planning table

CREATE TABLE IF NOT EXISTS interventions (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  intervention_type TEXT NOT NULL,
  barangay_name   TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'medium',
  status          TEXT NOT NULL DEFAULT 'pending',
  assigned_to     TEXT,
  team            TEXT,
  target_date     DATE,
  completed_at    TIMESTAMPTZ,
  created_by      TEXT,
  related_alert_id INTEGER REFERENCES alerts(id) ON DELETE SET NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for filtering and sorting
CREATE INDEX IF NOT EXISTS idx_interventions_barangay ON interventions(barangay_name);
CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status);
CREATE INDEX IF NOT EXISTS idx_interventions_priority ON interventions(priority);
CREATE INDEX IF NOT EXISTS idx_interventions_type ON interventions(intervention_type);
CREATE INDEX IF NOT EXISTS idx_interventions_target_date ON interventions(target_date);
CREATE INDEX IF NOT EXISTS idx_interventions_created_desc ON interventions(created_at DESC);
