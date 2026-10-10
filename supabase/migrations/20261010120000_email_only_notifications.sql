-- HOSQ email-only cutover (rev 2): 18 live patient rows found at apply time,
-- so this preserves phone data and relaxes instead of dropping.
-- New check-ins are email-identified; phone is legacy-optional.

-- 1. patients: email added (nullable UNIQUE: many NULLs allowed, values unique),
--    phone relaxed, Kenyan-phone trigger retired (new rows carry no phone).
ALTER TABLE patients ADD COLUMN IF NOT EXISTS email text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_email_unique'
  ) THEN
    ALTER TABLE patients ADD CONSTRAINT patients_email_unique UNIQUE (email);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_email_format'
  ) THEN
    ALTER TABLE patients
      ADD CONSTRAINT patients_email_format
      CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
ALTER TABLE patients ALTER COLUMN phone_number DROP NOT NULL;

DROP TRIGGER IF EXISTS trigger_enforce_kenyan_phone_on_patients ON patients;
DROP FUNCTION IF EXISTS enforce_kenyan_phone_on_patients();
DROP FUNCTION IF EXISTS normalize_kenyan_phone(text);

-- 2. cooldown overrides: email added, phone relaxed (1 live row preserved)
ALTER TABLE checkin_cooldown_overrides ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE checkin_cooldown_overrides ALTER COLUMN phone_number DROP NOT NULL;

-- 3. phone cooldown: skip rows whose patient has no phone (email path has its own rule)
CREATE OR REPLACE FUNCTION enforce_queue_cooldown_per_phone()
RETURNS trigger AS $$
DECLARE
  patient_phone text;
  entry_time timestamptz;
  latest_same_day timestamptz;
  bypass_until_ts timestamptz;
BEGIN
  entry_time := COALESCE(NEW.checked_in_at, now());

  SELECT phone_number
  INTO patient_phone
  FROM patients
  WHERE id = NEW.patient_id;

  IF patient_phone IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT bypass_until
  INTO bypass_until_ts
  FROM checkin_cooldown_overrides
  WHERE phone_number = patient_phone;

  IF bypass_until_ts IS NOT NULL AND entry_time <= bypass_until_ts THEN
    RETURN NEW;
  END IF;

  SELECT qe.checked_in_at
  INTO latest_same_day
  FROM queue_entries qe
  JOIN patients p ON p.id = qe.patient_id
  WHERE p.phone_number = patient_phone
    AND (qe.checked_in_at AT TIME ZONE 'Africa/Nairobi')::date = (entry_time AT TIME ZONE 'Africa/Nairobi')::date
  ORDER BY qe.checked_in_at DESC
  LIMIT 1;

  IF latest_same_day IS NOT NULL AND entry_time < latest_same_day + interval '6 hours' THEN
    RAISE EXCEPTION 'This phone number can only check in once every 6 hours. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. per-email 6h check-in cooldown (skips patients without email)
CREATE OR REPLACE FUNCTION enforce_queue_cooldown_per_email()
RETURNS trigger AS $$
DECLARE
  patient_email text;
  entry_time timestamptz;
  latest_same_day timestamptz;
  bypass_until_ts timestamptz;
BEGIN
  entry_time := COALESCE(NEW.checked_in_at, now());

  SELECT email
  INTO patient_email
  FROM patients
  WHERE id = NEW.patient_id;

  IF patient_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT bypass_until
  INTO bypass_until_ts
  FROM checkin_cooldown_overrides
  WHERE email = patient_email;

  IF bypass_until_ts IS NOT NULL AND entry_time <= bypass_until_ts THEN
    RETURN NEW;
  END IF;

  SELECT qe.checked_in_at
  INTO latest_same_day
  FROM queue_entries qe
  JOIN patients p ON p.id = qe.patient_id
  WHERE p.email = patient_email
    AND (qe.checked_in_at AT TIME ZONE 'Africa/Nairobi')::date = (entry_time AT TIME ZONE 'Africa/Nairobi')::date
  ORDER BY qe.checked_in_at DESC
  LIMIT 1;

  IF latest_same_day IS NOT NULL AND entry_time < latest_same_day + interval '6 hours' THEN
    RAISE EXCEPTION 'This email can only check in once every 6 hours. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_queue_cooldown_per_email ON queue_entries;
CREATE TRIGGER trigger_enforce_queue_cooldown_per_email
  BEFORE INSERT ON queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_queue_cooldown_per_email();

-- 5. email_logs (mirrors sms_logs policies)
CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL,
  email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  status text DEFAULT 'sent',
  provider_id text,
  error text,
  sent_at timestamptz DEFAULT now()
);
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated staff can insert email logs" ON email_logs;
CREATE POLICY "Authenticated staff can insert email logs"
  ON email_logs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can view email logs" ON email_logs;
CREATE POLICY "Authenticated users can view email logs"
  ON email_logs FOR SELECT TO authenticated USING (true);
