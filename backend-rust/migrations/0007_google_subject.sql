-- Bind federated accounts to the immutable provider subject after verified login.
ALTER TABLE accounts_userprofile ADD COLUMN google_subject_lookup varchar(64);
CREATE UNIQUE INDEX accounts_userprofile_google_subject_uniq
    ON accounts_userprofile (google_subject_lookup) WHERE google_subject_lookup IS NOT NULL;
