ALTER TABLE accounts_userprofile
    ADD COLUMN login_otp_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (login_otp_attempts BETWEEN 0 AND 5);
