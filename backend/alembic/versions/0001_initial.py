"""Initial schema — all tables, seed personas and intents.

Revision ID: 0001
Revises:
Create Date: 2026-06-10

"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

DDL = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                       VARCHAR(255) UNIQUE NOT NULL,
  password_hash               VARCHAR(255) NOT NULL,
  first_name                  VARCHAR(100),
  last_name                   VARCHAR(100),
  role                        VARCHAR(50) DEFAULT 'owner' CHECK (role IN ('owner','admin','member')),
  subscription_tier           VARCHAR(50) DEFAULT 'trial' CHECK (subscription_tier IN ('trial','starter','pro','business')),
  subscription_status         VARCHAR(50) DEFAULT 'active' CHECK (subscription_status IN ('active','paused','cancelled','expired')),
  trial_ends_at               TIMESTAMP,
  onboarding_completed        BOOLEAN DEFAULT FALSE,
  created_at                  TIMESTAMP DEFAULT NOW(),
  updated_at                  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE workspaces (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   VARCHAR(255) NOT NULL,
  owner_id               UUID NOT NULL REFERENCES users(id),
  plan_tier              VARCHAR(50) CHECK (plan_tier IN ('starter','pro','business')),
  monthly_outreach_limit INTEGER DEFAULT 1000,
  current_month_usage    INTEGER DEFAULT 0,
  team_seats             INTEGER DEFAULT 1,
  settings               JSONB DEFAULT '{}',
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE TABLE team_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  role         VARCHAR(50) DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  invited_at   TIMESTAMP DEFAULT NOW(),
  accepted_at  TIMESTAMP,
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE tone_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id),
  name                VARCHAR(255) NOT NULL,
  sample_messages     TEXT[] NOT NULL,
  extracted_style     JSONB DEFAULT '{}',
  system_prompt_addon TEXT,
  is_default          BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE personas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID REFERENCES workspaces(id),
  name                  VARCHAR(255) NOT NULL,
  tone_profile          VARCHAR(100),
  system_prompt_template TEXT NOT NULL,
  industry_vertical     VARCHAR(100),
  psychology_principle  VARCHAR(100),
  is_default            BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE TABLE campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  objective           TEXT NOT NULL,
  status              VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','ready','running','paused','completed','archived')),
  persona_id          UUID REFERENCES personas(id),
  tone_profile_id     UUID REFERENCES tone_profiles(id),
  target_audience     TEXT,
  cta_type            VARCHAR(50) CHECK (cta_type IN ('booking_link','reply','custom')),
  cta_value           VARCHAR(500),
  schedule_config     JSONB DEFAULT '{"working_hours_start": 9, "working_hours_end": 18, "timezone": "UTC", "send_weekends": false}',
  daily_send_limit    INTEGER DEFAULT 50,
  safety_settings     JSONB DEFAULT '{}',
  performance_metrics JSONB DEFAULT '{}',
  started_at          TIMESTAMP,
  completed_at        TIMESTAMP,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE sequence_steps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_order       INTEGER NOT NULL,
  step_type        VARCHAR(50) NOT NULL CHECK (step_type IN ('connection_request','message','follow_up')),
  message_template TEXT NOT NULL,
  delay_days       INTEGER DEFAULT 0,
  condition_logic  JSONB DEFAULT '{}',
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE objection_handlers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  trigger_phrases   TEXT[] NOT NULL,
  response_template TEXT NOT NULL,
  priority          INTEGER DEFAULT 0,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE icp_definitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id),
  name           VARCHAR(255),
  titles         TEXT[],
  industries     TEXT[],
  company_sizes  TEXT[],
  geographies    TEXT[],
  exclusion_list TEXT[],
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  campaign_id     UUID REFERENCES campaigns(id),
  source          VARCHAR(100),
  name            VARCHAR(255),
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  title           VARCHAR(255),
  company         VARCHAR(255),
  industry        VARCHAR(100),
  location        VARCHAR(255),
  linkedin_url    VARCHAR(500),
  email           VARCHAR(255),
  headline        TEXT,
  about_summary   TEXT,
  recent_posts    JSONB DEFAULT '[]',
  mutual_connections JSONB DEFAULT '[]',
  quality_score   DECIMAL(3,2),
  icp_match_pct   DECIMAL(5,2),
  status          VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new','queued','contacted','engaged','hot','booked','skipped','archived')),
  custom_fields   JSONB DEFAULT '{}',
  enriched_at     TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_leads_workspace ON leads(workspace_id);
CREATE INDEX idx_leads_campaign ON leads(campaign_id);
CREATE INDEX idx_leads_status ON leads(status);

CREATE TABLE linkedin_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  signal_type     VARCHAR(100) CHECK (signal_type IN ('job_change','funding_round','post_engagement','company_news','promotion','new_connection')),
  signal_data     JSONB,
  detected_at     TIMESTAMP DEFAULT NOW(),
  relevance_score DECIMAL(3,2),
  used_in_draft   BOOLEAN DEFAULT FALSE
);

CREATE TABLE draft_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id),
  sequence_step_id UUID NOT NULL REFERENCES sequence_steps(id),
  ai_draft        TEXT NOT NULL,
  personalization_hooks JSONB DEFAULT '{}',
  human_edit      TEXT,
  status          VARCHAR(50) DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','edited_and_approved','skipped','sent','failed')),
  scheduled_for   TIMESTAMP,
  approved_at     TIMESTAMP,
  approved_by     UUID REFERENCES users(id),
  sent_at         TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_draft_queue_campaign ON draft_queue(campaign_id);
CREATE INDEX idx_draft_queue_status ON draft_queue(status);

CREATE TABLE conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id),
  lead_id           UUID NOT NULL REFERENCES leads(id),
  status            VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','hot_lead','booked','archived')),
  priority_score    DECIMAL(3,2) DEFAULT 0.50,
  pipeline_value    DECIMAL(10,2),
  last_message_at   TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type      VARCHAR(20) NOT NULL CHECK (sender_type IN ('user','prospect')),
  content          TEXT NOT NULL,
  message_type     VARCHAR(50) DEFAULT 'text',
  sentiment_score  DECIMAL(4,3),
  intent_class     VARCHAR(100),
  created_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);

CREATE TABLE intents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) UNIQUE NOT NULL,
  description     TEXT,
  trigger_patterns TEXT[],
  response_strategy VARCHAR(100),
  requires_attention BOOLEAN DEFAULT FALSE
);

CREATE TABLE sending_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id),
  linkedin_profile_url VARCHAR(500),
  account_label       VARCHAR(255),
  status              VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','paused','restricted')),
  daily_send_limit    INTEGER DEFAULT 50,
  weekly_connection_limit INTEGER DEFAULT 100,
  sends_today         INTEGER DEFAULT 0,
  sends_this_week     INTEGER DEFAULT 0,
  connections_this_week INTEGER DEFAULT 0,
  health_score        DECIMAL(5,2) DEFAULT 100.00,
  last_reset_date     DATE,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE safety_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES sending_accounts(id),
  action_type     VARCHAR(100) NOT NULL,
  action_timestamp TIMESTAMP DEFAULT NOW(),
  details         JSONB DEFAULT '{}',
  daily_count_at_time INTEGER,
  weekly_count_at_time INTEGER
);
CREATE INDEX idx_safety_logs_account ON safety_logs(account_id);

CREATE TABLE restriction_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES sending_accounts(id),
  restriction_type VARCHAR(100),
  severity         VARCHAR(50) CHECK (severity IN ('warning','soft_limit','hard_limit','suspension')),
  detected_at      TIMESTAMP DEFAULT NOW(),
  resolved_at      TIMESTAMP,
  notes            TEXT
);

CREATE TABLE knowledge_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename       VARCHAR(500) NOT NULL,
  file_type      VARCHAR(50) CHECK (file_type IN ('pdf','docx','txt','url')),
  file_size      INTEGER,
  file_path      VARCHAR(500),
  upload_status  VARCHAR(50) DEFAULT 'processing' CHECK (upload_status IN ('processing','ready','failed')),
  vector_status  VARCHAR(50) DEFAULT 'pending' CHECK (vector_status IN ('pending','indexed','failed')),
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE document_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_text      TEXT NOT NULL,
  embedding       VECTOR(1024),
  metadata        JSONB DEFAULT '{}',
  chunk_order     INTEGER
);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE campaign_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id),
  priority    INTEGER DEFAULT 0
);

CREATE TABLE analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  event_type  VARCHAR(100) NOT NULL,
  event_data  JSONB DEFAULT '{}',
  timestamp   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE daily_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  drafts_generated INTEGER DEFAULT 0,
  drafts_approved  INTEGER DEFAULT 0,
  drafts_edited    INTEGER DEFAULT 0,
  messages_sent    INTEGER DEFAULT 0,
  replies_received INTEGER DEFAULT 0,
  positive_replies INTEGER DEFAULT 0,
  meetings_booked  INTEGER DEFAULT 0,
  UNIQUE(campaign_id, date)
);

CREATE TABLE engagement_heatmaps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id),
  hour_of_day      SMALLINT CHECK (hour_of_day BETWEEN 0 AND 23),
  day_of_week      SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  engagement_score DECIMAL(4,3),
  sample_size      INTEGER
);
"""

SEED = """
INSERT INTO personas (name, tone_profile, system_prompt_template, industry_vertical, psychology_principle, is_default) VALUES
('Professional Consultant', 'formal_authoritative', 'You are drafting messages as a senior industry consultant. Tone: authoritative but approachable. Focus on demonstrating deep expertise.', 'B2B Services', 'Authority', TRUE),
('Friendly Advisor', 'warm_conversational', 'You are drafting messages as a trusted advisor who genuinely cares about the prospect''s challenges. Tone: warm, empathetic, conversational.', 'Coaching/Consulting', 'Liking', TRUE),
('Direct Closer', 'assertive_outcome_focused', 'You are drafting messages that are results-focused and outcome-driven. Tone: confident, concise, action-oriented.', 'High-Ticket Sales', 'Scarcity', TRUE),
('Educational Guide', 'informative_helpful', 'You are drafting messages that share valuable insights generously. Tone: knowledgeable, helpful, non-salesy.', 'Courses/Education', 'Reciprocity', TRUE),
('Peer Colleague', 'casual_relatable', 'You are drafting messages as a fellow professional in the same space. Tone: casual, relatable, peer-to-peer.', 'Startup/Tech', 'Social Proof', TRUE);

INSERT INTO intents (name, trigger_patterns, response_strategy, requires_attention) VALUES
('greeting', ARRAY['hi','hello','hey','morning'], 'warm_response_qualify', FALSE),
('interest_positive', ARRAY['interested','sounds good','tell me more','love to'], 'provide_value_progress_cta', FALSE),
('interest_exploring', ARRAY['maybe','let me think','not sure','possibly'], 'address_hesitation_social_proof', FALSE),
('objection_price', ARRAY['expensive','cost','budget','pricing','too much'], 'value_reframe_roi', FALSE),
('objection_timing', ARRAY['not now','busy','later','bad timing'], 'empathy_specific_followup', FALSE),
('objection_competitor', ARRAY['using','already have','switched to'], 'differentiation_unique_value', FALSE),
('objection_authority', ARRAY['need to ask','not my decision','manager','boss'], 'multistakeholder_offer', FALSE),
('booking_request', ARRAY['book a call','schedule','calendar','meeting','chat'], 'provide_booking_link', FALSE),
('contact_request', ARRAY['phone','email','contact','reach you'], 'collect_contact_qualify', FALSE),
('question_product', ARRAY['how does','what is','features','explain','show me'], 'answer_from_kb', FALSE),
('question_company', ARRAY['who are you','company','about you','tell me about'], 'brief_intro_credibility', FALSE),
('negative_mild', ARRAY['not interested','no thanks','pass','not for me'], 'graceful_acceptance', TRUE),
('negative_hostile', ARRAY['stop','annoying','spam','leave me alone','block'], 'immediate_stop', TRUE),
('opt_out', ARRAY['unsubscribe','remove me','opt out'], 'process_immediately', TRUE);
"""

TABLES = [
    "engagement_heatmaps", "daily_metrics", "analytics_events", "campaign_sources",
    "document_chunks", "knowledge_documents", "restriction_events", "safety_logs",
    "sending_accounts", "intents", "messages", "conversations", "draft_queue",
    "linkedin_signals", "leads", "icp_definitions", "objection_handlers",
    "sequence_steps", "campaigns", "personas", "tone_profiles", "team_members",
    "workspaces", "users",
]


def upgrade() -> None:
    op.execute(DDL)
    op.execute(SEED)


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
