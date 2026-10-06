-- Keep outcome_status unchanged for source traceability and existing integrations.
-- Canonical fields are derived so every ingestion and edit path stays consistent.
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS case_status TEXT GENERATED ALWAYS AS (
  CASE
    WHEN UPPER(TRIM(outcome_status)) = 'DIAGNOSED' THEN 'DIAGNOSED'
    WHEN UPPER(TRIM(outcome_status)) IN ('ON TREATMENT', 'ON TX', 'ONGOING TREATMENT', 'ON GOING TREATMENT') THEN 'ON TREATMENT'
    ELSE NULL
  END
) STORED;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS source_outcome_status TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS treatment_outcome TEXT GENERATED ALWAYS AS (
  CASE UPPER(TRIM(outcome_status))
    WHEN 'CURED' THEN 'CURED'
    WHEN 'TREATMENT COMPLETED' THEN 'TREATMENT COMPLETED'
    WHEN 'FAILED' THEN 'TREATMENT FAILED'
    WHEN 'TREATMENT FAILED' THEN 'TREATMENT FAILED'
    WHEN 'LOST TO FF-UP' THEN 'LOST TO FOLLOW-UP'
    WHEN 'LOST TO FOLLOW UP' THEN 'LOST TO FOLLOW-UP'
    WHEN 'LOST TO FOLLOW-UP' THEN 'LOST TO FOLLOW-UP'
    WHEN 'LTFU' THEN 'LOST TO FOLLOW-UP'
    WHEN 'DIED' THEN 'DIED'
    WHEN 'NOT EVALUATED' THEN 'NOT EVALUATED'
    WHEN 'EXCLUDED' THEN 'EXCLUDED'
    ELSE NULL
  END
) STORED;
CREATE INDEX IF NOT EXISTS idx_tb_cases_case_status ON tb_cases(case_status);
CREATE INDEX IF NOT EXISTS idx_tb_cases_treatment_outcome ON tb_cases(treatment_outcome);
