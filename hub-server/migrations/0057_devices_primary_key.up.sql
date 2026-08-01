DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'devices'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE devices
            ADD CONSTRAINT devices_pkey PRIMARY KEY (id);
    END IF;
END
$$;
