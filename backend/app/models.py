import uuid
from datetime import date, datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), default=uuid.uuid4)


def ts_now() -> Mapped[datetime]:
    return mapped_column(DateTime, server_default=text("NOW()"), default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(50), default="owner", server_default="owner")
    subscription_tier: Mapped[str] = mapped_column(String(50), default="trial", server_default="trial")
    subscription_status: Mapped[str] = mapped_column(String(50), default="active", server_default="active")
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("FALSE"))
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    plan_tier: Mapped[str | None] = mapped_column(String(50))
    monthly_outreach_limit: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    current_month_usage: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    team_seats: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    settings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()

    owner: Mapped[User] = relationship()


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="member", server_default="member")
    invited_at: Mapped[datetime] = ts_now()
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)

    user: Mapped[User] = relationship()


class ToneProfile(Base):
    __tablename__ = "tone_profiles"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sample_messages: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    extracted_style: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    system_prompt_addon: Mapped[str | None] = mapped_column(Text)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("FALSE"))
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()


class Persona(Base):
    __tablename__ = "personas"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tone_profile: Mapped[str | None] = mapped_column(String(100))
    system_prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    industry_vertical: Mapped[str | None] = mapped_column(String(100))
    psychology_principle: Mapped[str | None] = mapped_column(String(100))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("FALSE"))
    created_at: Mapped[datetime] = ts_now()


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    objective: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft", server_default="draft")
    persona_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("personas.id"))
    tone_profile_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tone_profiles.id"))
    target_audience: Mapped[str | None] = mapped_column(Text)
    cta_type: Mapped[str | None] = mapped_column(String(50))
    cta_value: Mapped[str | None] = mapped_column(String(500))
    schedule_config: Mapped[dict] = mapped_column(
        JSONB,
        default=lambda: {"working_hours_start": 9, "working_hours_end": 18, "timezone": "UTC", "send_weekends": False},
        server_default=text('\'{"working_hours_start": 9, "working_hours_end": 18, "timezone": "UTC", "send_weekends": false}\''),
    )
    daily_send_limit: Mapped[int] = mapped_column(Integer, default=50, server_default="50")
    safety_settings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    performance_metrics: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()

    steps: Mapped[list["SequenceStep"]] = relationship(back_populates="campaign", cascade="all, delete-orphan", order_by="SequenceStep.step_order")
    objection_handlers: Mapped[list["ObjectionHandler"]] = relationship(back_populates="campaign", cascade="all, delete-orphan")


class SequenceStep(Base):
    __tablename__ = "sequence_steps"

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    step_type: Mapped[str] = mapped_column(String(50), nullable=False)
    message_template: Mapped[str] = mapped_column(Text, nullable=False)
    delay_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    condition_logic: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    created_at: Mapped[datetime] = ts_now()

    campaign: Mapped[Campaign] = relationship(back_populates="steps")


class ObjectionHandler(Base):
    __tablename__ = "objection_handlers"

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    trigger_phrases: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    response_template: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = ts_now()

    campaign: Mapped[Campaign] = relationship(back_populates="objection_handlers")


class ICPDefinition(Base):
    __tablename__ = "icp_definitions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    titles: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    industries: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    company_sizes: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    geographies: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    exclusion_list: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    created_at: Mapped[datetime] = ts_now()


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id"))
    source: Mapped[str | None] = mapped_column(String(100))
    name: Mapped[str | None] = mapped_column(String(255))
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    title: Mapped[str | None] = mapped_column(String(255))
    company: Mapped[str | None] = mapped_column(String(255))
    industry: Mapped[str | None] = mapped_column(String(100))
    location: Mapped[str | None] = mapped_column(String(255))
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    email: Mapped[str | None] = mapped_column(String(255))
    headline: Mapped[str | None] = mapped_column(Text)
    about_summary: Mapped[str | None] = mapped_column(Text)
    recent_posts: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'"))
    mutual_connections: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'"))
    quality_score: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    icp_match_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    status: Mapped[str] = mapped_column(String(50), default="new", server_default="new")
    custom_fields: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    enriched_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()


class LinkedInSignal(Base):
    __tablename__ = "linkedin_signals"

    id: Mapped[uuid.UUID] = uuid_pk()
    lead_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"))
    signal_type: Mapped[str | None] = mapped_column(String(100))
    signal_data: Mapped[dict | None] = mapped_column(JSONB)
    detected_at: Mapped[datetime] = ts_now()
    relevance_score: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    used_in_draft: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("FALSE"))


class DraftQueueItem(Base):
    __tablename__ = "draft_queue"

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    lead_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id"), nullable=False)
    sequence_step_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sequence_steps.id"), nullable=False)
    ai_draft: Mapped[str] = mapped_column(Text, nullable=False)
    personalization_hooks: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    human_edit: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending_review", server_default="pending_review")
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()

    lead: Mapped[Lead] = relationship()
    sequence_step: Mapped[SequenceStep] = relationship()


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id"), nullable=False)
    lead_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="active", server_default="active")
    priority_score: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=Decimal("0.50"), server_default="0.50")
    pipeline_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()

    lead: Mapped[Lead] = relationship()
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender_type: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(String(50), default="text", server_default="text")
    sentiment_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    intent_class: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = ts_now()

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Intent(Base):
    __tablename__ = "intents"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    trigger_patterns: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    response_strategy: Mapped[str | None] = mapped_column(String(100))
    requires_attention: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("FALSE"))


class SendingAccount(Base):
    __tablename__ = "sending_accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    linkedin_profile_url: Mapped[str | None] = mapped_column(String(500))
    account_label: Mapped[str | None] = mapped_column(String(255))
    # Delivery provider: "manual" (human sends on LinkedIn) or "unipile".
    provider: Mapped[str] = mapped_column(String(50), default="manual", server_default="manual")
    provider_account_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(50), default="active", server_default="active")
    daily_send_limit: Mapped[int] = mapped_column(Integer, default=50, server_default="50")
    weekly_connection_limit: Mapped[int] = mapped_column(Integer, default=100, server_default="100")
    sends_today: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sends_this_week: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    connections_this_week: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    health_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("100.00"), server_default="100.00")
    last_reset_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = ts_now()
    updated_at: Mapped[datetime] = ts_now()


class SafetyLog(Base):
    __tablename__ = "safety_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sending_accounts.id"), nullable=False)
    action_type: Mapped[str] = mapped_column(String(100), nullable=False)
    action_timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=text("NOW()"), default=datetime.utcnow)
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    daily_count_at_time: Mapped[int | None] = mapped_column(Integer)
    weekly_count_at_time: Mapped[int | None] = mapped_column(Integer)


class RestrictionEvent(Base):
    __tablename__ = "restriction_events"

    id: Mapped[uuid.UUID] = uuid_pk()
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sending_accounts.id"), nullable=False)
    restriction_type: Mapped[str | None] = mapped_column(String(100))
    severity: Mapped[str | None] = mapped_column(String(50))
    detected_at: Mapped[datetime] = ts_now()
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(Text)


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str | None] = mapped_column(String(50))
    file_size: Mapped[int | None] = mapped_column(Integer)
    file_path: Mapped[str | None] = mapped_column(String(500))
    upload_status: Mapped[str] = mapped_column(String(50), default="processing", server_default="processing")
    vector_status: Mapped[str] = mapped_column(String(50), default="pending", server_default="pending")
    created_at: Mapped[datetime] = ts_now()


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("knowledge_documents.id", ondelete="CASCADE"), nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1024))
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, server_default=text("'{}'"))
    chunk_order: Mapped[int | None] = mapped_column(Integer)


class CampaignSource(Base):
    __tablename__ = "campaign_sources"

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("knowledge_documents.id"), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    document: Mapped[KnowledgeDocument] = relationship()


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id"))
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    event_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=text("NOW()"), default=datetime.utcnow)


class DailyMetric(Base):
    __tablename__ = "daily_metrics"
    __table_args__ = (UniqueConstraint("campaign_id", "date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    drafts_generated: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    drafts_approved: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    drafts_edited: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    messages_sent: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    replies_received: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    positive_replies: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    meetings_booked: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class EngagementHeatmap(Base):
    __tablename__ = "engagement_heatmaps"

    id: Mapped[uuid.UUID] = uuid_pk()
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id"), nullable=False)
    hour_of_day: Mapped[int | None] = mapped_column(SmallInteger)
    day_of_week: Mapped[int | None] = mapped_column(SmallInteger)
    engagement_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    sample_size: Mapped[int | None] = mapped_column(Integer)
