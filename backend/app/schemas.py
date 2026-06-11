import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth ----------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    first_name: str | None
    last_name: str | None
    role: str
    subscription_tier: str
    subscription_status: str
    trial_ends_at: datetime | None
    onboarding_completed: bool


class WorkspaceOut(ORMModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    plan_tier: str | None
    monthly_outreach_limit: int
    current_month_usage: int
    team_seats: int
    settings: dict


class AuthResponse(BaseModel):
    user: UserOut
    token: str
    refresh_token: str
    workspace: WorkspaceOut | None = None


class TokenResponse(BaseModel):
    token: str
    refresh_token: str


class SuccessResponse(BaseModel):
    success: bool = True
    detail: str | None = None


# ---------- Workspace / team ----------

class WorkspaceUpdate(BaseModel):
    name: str | None = None
    settings: dict | None = None
    monthly_outreach_limit: int | None = None


class TeamInvite(BaseModel):
    email: EmailStr
    role: Literal["admin", "member", "viewer"] = "member"


class TeamMemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    first_name: str | None
    last_name: str | None
    role: str
    invited_at: datetime
    accepted_at: datetime | None


# ---------- Tone profiles ----------

class ToneProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sample_messages: list[str] = Field(min_length=1)
    is_default: bool = False


class ToneProfileUpdate(BaseModel):
    name: str | None = None
    sample_messages: list[str] | None = None
    is_default: bool | None = None


class ToneProfileOut(ORMModel):
    id: uuid.UUID
    name: str
    sample_messages: list[str]
    extracted_style: dict
    system_prompt_addon: str | None
    is_default: bool
    created_at: datetime


class ToneTestRequest(BaseModel):
    prompt: str


class ToneTestResponse(BaseModel):
    message: str


# ---------- Personas ----------

class PersonaOut(ORMModel):
    id: uuid.UUID
    name: str
    tone_profile: str | None
    industry_vertical: str | None
    psychology_principle: str | None
    is_default: bool


# ---------- Campaigns ----------

class ScheduleConfig(BaseModel):
    working_hours_start: int = 9
    working_hours_end: int = 18
    timezone: str = "UTC"
    send_weekends: bool = False


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    objective: str = Field(min_length=1)
    persona_id: uuid.UUID | None = None
    tone_profile_id: uuid.UUID | None = None
    target_audience: str | None = None
    cta_type: Literal["booking_link", "reply", "custom"] | None = None
    cta_value: str | None = None
    schedule_config: ScheduleConfig | None = None
    daily_send_limit: int = 50
    safety_settings: dict = {}


class CampaignUpdate(BaseModel):
    name: str | None = None
    objective: str | None = None
    persona_id: uuid.UUID | None = None
    tone_profile_id: uuid.UUID | None = None
    target_audience: str | None = None
    cta_type: Literal["booking_link", "reply", "custom"] | None = None
    cta_value: str | None = None
    schedule_config: ScheduleConfig | None = None
    daily_send_limit: int | None = None
    safety_settings: dict | None = None


class SequenceStepCreate(BaseModel):
    step_order: int = Field(ge=1)
    step_type: Literal["connection_request", "message", "follow_up"]
    message_template: str = Field(min_length=1)
    delay_days: int = Field(default=0, ge=0)
    condition_logic: dict = {}


class SequenceStepUpdate(BaseModel):
    step_order: int | None = None
    step_type: Literal["connection_request", "message", "follow_up"] | None = None
    message_template: str | None = None
    delay_days: int | None = None
    condition_logic: dict | None = None


class SequenceStepOut(ORMModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    step_order: int
    step_type: str
    message_template: str
    delay_days: int
    condition_logic: dict


class StepReorderRequest(BaseModel):
    step_ids: list[uuid.UUID]


class SequenceGenerateRequest(BaseModel):
    objective: str = Field(min_length=1)
    target_audience: str | None = None
    persona_id: uuid.UUID | None = None
    tone_profile_id: uuid.UUID | None = None
    num_steps: int = Field(default=3, ge=1, le=7)


class GeneratedStep(BaseModel):
    step_order: int
    step_type: Literal["connection_request", "message", "follow_up"]
    message_template: str
    delay_days: int


class SequenceGenerateResponse(BaseModel):
    steps: list[GeneratedStep]


class CampaignBriefRequest(BaseModel):
    brief: str = Field(min_length=10)
    num_steps: int = Field(default=3, ge=1, le=7)


class CampaignBriefResponse(BaseModel):
    name: str
    objective: str
    target_audience: str | None
    cta_type: Literal["booking_link", "reply", "custom"]
    cta_value: str | None
    persona_id: uuid.UUID | None
    persona_name: str | None
    tone_profile_id: uuid.UUID | None
    daily_send_limit: int = 50
    steps: list[GeneratedStep]


class ObjectionHandlerCreate(BaseModel):
    trigger_phrases: list[str] = Field(min_length=1)
    response_template: str = Field(min_length=1)
    priority: int = 0


class ObjectionHandlerUpdate(BaseModel):
    trigger_phrases: list[str] | None = None
    response_template: str | None = None
    priority: int | None = None


class ObjectionHandlerOut(ORMModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    trigger_phrases: list[str]
    response_template: str
    priority: int


class CampaignOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    objective: str
    status: str
    persona_id: uuid.UUID | None
    tone_profile_id: uuid.UUID | None
    target_audience: str | None
    cta_type: str | None
    cta_value: str | None
    schedule_config: dict
    daily_send_limit: int
    safety_settings: dict
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CampaignDetailOut(CampaignOut):
    steps: list[SequenceStepOut] = []
    objection_handlers: list[ObjectionHandlerOut] = []


class Paginated(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int


# ---------- Leads ----------

class LeadCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    linkedin_url: str = Field(min_length=1, max_length=500)
    title: str | None = None
    company: str | None = None
    industry: str | None = None
    location: str | None = None
    email: str | None = None
    campaign_id: uuid.UUID | None = None
    custom_fields: dict = {}


class LeadUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    title: str | None = None
    company: str | None = None
    industry: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    email: str | None = None
    campaign_id: uuid.UUID | None = None
    status: str | None = None
    custom_fields: dict | None = None


class LeadOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    campaign_id: uuid.UUID | None
    source: str | None
    name: str | None
    first_name: str | None
    last_name: str | None
    title: str | None
    company: str | None
    industry: str | None
    location: str | None
    linkedin_url: str | None
    email: str | None
    headline: str | None
    about_summary: str | None
    recent_posts: list
    mutual_connections: list
    quality_score: float | None
    icp_match_pct: float | None
    status: str
    custom_fields: dict
    connection_accepted_at: datetime | None = None
    enriched_at: datetime | None
    created_at: datetime


class LeadImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[str]


class LeadBulkAssign(BaseModel):
    lead_ids: list[uuid.UUID] = Field(min_length=1)
    campaign_id: uuid.UUID


class LeadSearchRequest(BaseModel):
    icp_id: uuid.UUID | None = None
    titles: list[str] | None = None
    industries: list[str] | None = None
    geographies: list[str] | None = None
    min_quality_score: float | None = None


class ICPCreate(BaseModel):
    name: str | None = None
    titles: list[str] = []
    industries: list[str] = []
    company_sizes: list[str] = []
    geographies: list[str] = []
    exclusion_list: list[str] = []


class ICPOut(ORMModel):
    id: uuid.UUID
    name: str | None
    titles: list[str] | None
    industries: list[str] | None
    company_sizes: list[str] | None
    geographies: list[str] | None
    exclusion_list: list[str] | None


class SignalOut(ORMModel):
    id: uuid.UUID
    lead_id: uuid.UUID | None
    signal_type: str | None
    signal_data: dict | None
    detected_at: datetime
    relevance_score: float | None
    used_in_draft: bool


# ---------- Drafts ----------

class DraftGenerateRequest(BaseModel):
    campaign_id: uuid.UUID


class LeadBrief(BaseModel):
    id: uuid.UUID
    name: str | None
    first_name: str | None
    last_name: str | None
    title: str | None
    company: str | None
    headline: str | None
    linkedin_url: str | None


class DraftOut(BaseModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    lead_id: uuid.UUID
    sequence_step_id: uuid.UUID
    lead: LeadBrief | None
    step_type: str | None
    ai_draft: str
    human_edit: str | None
    personalization_hooks: dict
    status: str
    scheduled_for: datetime | None
    approved_at: datetime | None
    sent_at: datetime | None
    created_at: datetime


class DraftUpdate(BaseModel):
    human_edit: str | None = None
    scheduled_for: datetime | None = None


class BulkApproveRequest(BaseModel):
    draft_ids: list[uuid.UUID]


class DraftStats(BaseModel):
    pending_review: int
    approved: int
    sent_today: int
    skipped: int


# ---------- Inbox ----------

class ConversationListItem(BaseModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    lead: LeadBrief | None
    status: str
    priority_score: float
    pipeline_value: float | None
    last_message_at: datetime | None
    last_message_preview: str | None


class MessageOut(ORMModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_type: str
    content: str
    message_type: str
    sentiment_score: float | None
    intent_class: str | None
    created_at: datetime


class ConversationDetail(BaseModel):
    conversation: ConversationListItem
    messages: list[MessageOut]


class ReplyRequest(BaseModel):
    content: str = Field(min_length=1)


class ProspectMessageRequest(BaseModel):
    content: str = Field(min_length=1)


class PriorityUpdate(BaseModel):
    priority_score: float = Field(ge=0, le=1)


class InboxStats(BaseModel):
    active: int
    hot_leads: int
    needs_attention: int


class SuggestedReply(BaseModel):
    approach: Literal["direct", "value_add", "soft"]
    content: str


class SuggestionsResponse(BaseModel):
    suggestions: list[SuggestedReply]


# ---------- Knowledge base ----------

class KnowledgeDocumentOut(ORMModel):
    id: uuid.UUID
    filename: str
    file_type: str | None
    file_size: int | None
    upload_status: str
    vector_status: str
    created_at: datetime


class KBChatRequest(BaseModel):
    query: str = Field(min_length=1)
    campaign_id: uuid.UUID | None = None


class KBChatResponse(BaseModel):
    answer: str
    sources: list[str]


class CampaignSourceCreate(BaseModel):
    document_id: uuid.UUID
    priority: int = 0


class CampaignSourceOut(BaseModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    document_id: uuid.UUID
    priority: int
    filename: str | None = None


# ---------- Safety ----------

class SendingAccountCreate(BaseModel):
    account_label: str = Field(min_length=1, max_length=255)
    linkedin_profile_url: str | None = None
    daily_send_limit: int = 50
    weekly_connection_limit: int = 100


class SendingAccountUpdate(BaseModel):
    account_label: str | None = None
    daily_send_limit: int | None = None
    weekly_connection_limit: int | None = None
    status: Literal["active", "paused", "restricted"] | None = None
    provider: Literal["manual", "unipile"] | None = None
    provider_account_id: str | None = None


class ConnectAccountRequest(BaseModel):
    success_redirect_url: str | None = None


class ConnectAccountResponse(BaseModel):
    url: str
    instructions: str


class SendingAccountOut(ORMModel):
    id: uuid.UUID
    linkedin_profile_url: str | None
    account_label: str | None
    provider: str = "manual"
    provider_account_id: str | None = None
    delivery_connected: bool = False
    status: str

    @model_validator(mode="after")
    def _compute_delivery_connected(self):
        from app.services.delivery import unipile_configured

        self.delivery_connected = self.provider == "unipile" and bool(self.provider_account_id) and unipile_configured()
        return self
    daily_send_limit: int
    weekly_connection_limit: int
    sends_today: int
    sends_this_week: int
    connections_this_week: int
    health_score: float
    last_reset_date: datetime | None = None


class RestrictionEventCreate(BaseModel):
    restriction_type: str
    severity: Literal["warning", "soft_limit", "hard_limit", "suspension"]
    notes: str | None = None


class RestrictionEventOut(ORMModel):
    id: uuid.UUID
    account_id: uuid.UUID
    restriction_type: str | None
    severity: str | None
    detected_at: datetime
    resolved_at: datetime | None
    notes: str | None


class SafetyLogOut(ORMModel):
    id: uuid.UUID
    account_id: uuid.UUID
    action_type: str
    action_timestamp: datetime
    details: dict
    daily_count_at_time: int | None
    weekly_count_at_time: int | None


class SafetyDashboard(BaseModel):
    accounts: list[SendingAccountOut]
    recommendations: list[str]


class AccountHistory(BaseModel):
    safety_logs: list[SafetyLogOut]
    restriction_events: list[RestrictionEventOut]
