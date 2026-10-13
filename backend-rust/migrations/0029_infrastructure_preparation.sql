-- Additive preparation only: preserve all destination, VPN and backup records.
CREATE TABLE public.infrastructure_config (
    id integer PRIMARY KEY CHECK (id=1),
    config jsonb NOT NULL CHECK (jsonb_typeof(config)='object'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    updated_by uuid REFERENCES public.accounts_userprofile(id) ON DELETE SET NULL
);
CREATE TABLE public.infrastructure_evidence (
    id uuid PRIMARY KEY,
    revision bigint NOT NULL,
    state text NOT NULL CHECK (state IN ('NOT_CONFIGURED','CONFIGURED','VALIDATING','VERIFIED','ACTIVE','DEGRADED','DISCONNECTED','FAILED','BLOCKED')),
    checks jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    actor_id uuid REFERENCES public.accounts_userprofile(id) ON DELETE SET NULL
);
CREATE INDEX infrastructure_evidence_created_idx ON public.infrastructure_evidence(created_at DESC,id);
