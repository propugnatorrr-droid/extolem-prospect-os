DO $$
BEGIN
  IF to_regclass('"Contact"') IS NOT NULL THEN
    DELETE FROM "Contact"
    WHERE "id" IN (
      SELECT "id"
      FROM (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "businessId", "type", "value"
            ORDER BY "createdAt" ASC, "id" ASC
          ) AS duplicate_number
        FROM "Contact"
      ) AS ranked_contacts
      WHERE duplicate_number > 1
    );

    CREATE UNIQUE INDEX IF NOT EXISTS
      "Contact_businessId_type_value_key"
      ON "Contact" ("businessId", "type", "value");
  END IF;
END

$$;
