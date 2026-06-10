// ---------- Auth ----------

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface Workspace {
  id: string;
  name: string;
  plan_tier: string;
  monthly_outreach_limit: number;
  current_month_usage: number;
  team_seats: number;
  settings: Record<string, unknown>;
}

export interface LoginResponse {
  user: User;
  token: string;
  refresh_token: string;
}

export interface RegisterResponse extends LoginResponse {
  workspace: Workspace;
}

export interface RefreshResponse {
  token: string;
  refresh_token: string;
}

// ---------- Team ----------

export interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  invited_at: string;
  accepted_at: string | null;
}

// ---------- Tone profiles ----------

export interface ToneProfile {
  id: string;
  name: string;
  sample_messages: string[];
  extracted_style: Record<string, string | number | boolean> | null;
  system_prompt_addon: string | null;
  is_default: boolean;
}

// ---------- Personas ----------

export interface Persona {
  id: string;
  name: string;
  tone_profile: string;
  industry_vertical: string;
  psychology_principle: string;
}

// ---------- Campaigns ----------

export type CampaignStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'archived';

export type CtaType = 'booking_link' | 'reply' | 'custom';

export type StepType = 'connection_request' | 'message' | 'follow_up';

export interface CampaignStep {
  id: string;
  step_order: number;
  step_type: StepType;
  message_template: string;
  delay_days: number;
}

export interface ObjectionHandler {
  id: string;
  trigger_phrases: string[];
  response_template: string;
  priority: number;
}

export interface Campaign {
  id: string;
  name: string;
  objective: string;
  persona_id?: string | null;
  tone_profile_id?: string | null;
  target_audience?: string | null;
  cta_type: CtaType;
  cta_value?: string | null;
  daily_send_limit?: number | null;
  schedule_config?: Record<string, unknown> | null;
  status: CampaignStatus;
  created_at?: string;
}

export interface CampaignDetail extends Campaign {
  steps: CampaignStep[];
  objection_handlers: ObjectionHandler[];
}

// ---------- AI campaign builder ----------

export interface GeneratedStep {
  step_order: number;
  step_type: StepType;
  message_template: string;
  delay_days: number;
}

export interface ParsedBrief {
  name: string;
  objective: string;
  target_audience: string;
  cta_type: CtaType;
  cta_value: string | null;
  persona_id: string | null;
  persona_name: string | null;
  tone_profile_id: string | null;
  daily_send_limit: number;
  steps: GeneratedStep[];
}

export interface GeneratedSequence {
  steps: GeneratedStep[];
}

export interface CampaignPerformance {
  drafts_generated: number;
  drafts_approved: number;
  drafts_edited_pct: number;
  messages_sent: number;
  reply_rate: number;
  positive_reply_rate: number;
  meetings_booked: number;
  avg_reply_time_hours: number;
  top_performing_signals: string[];
  account_health_avg: number;
}

// ---------- Pagination ----------

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ---------- Drafts ----------

export type DraftStatus =
  | 'pending_review'
  | 'approved'
  | 'edited_and_approved'
  | 'skipped'
  | 'sent'
  | 'failed';

export interface DraftLead {
  name: string;
  title: string;
  company: string;
  headline: string;
}

export interface Draft {
  id: string;
  campaign_id: string;
  lead: DraftLead;
  ai_draft: string;
  human_edit: string | null;
  personalization_hooks: Record<string, string>;
  status: DraftStatus;
  scheduled_for: string | null;
  created_at: string;
}

export interface DraftStats {
  pending_review: number;
  approved: number;
  sent_today: number;
  skipped: number;
}

// ---------- Leads ----------

export type LeadStatus =
  | 'new'
  | 'queued'
  | 'contacted'
  | 'engaged'
  | 'hot'
  | 'booked'
  | 'skipped'
  | 'archived';

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string | null;
  company: string | null;
  industry: string | null;
  location: string | null;
  linkedin_url: string;
  email: string | null;
  headline: string | null;
  quality_score: number | null;
  icp_match_pct: number | null;
  status: LeadStatus;
  enriched_at: string | null;
}

export interface LeadImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface LeadImportPreview {
  headers: string[];
  sample_rows: Record<string, string>[];
  suggested_mapping: Record<string, string>;
  missing_required: string[];
  total_rows: number;
  target_fields: string[];
}

// ---------- ICP ----------

export interface IcpProfile {
  id: string;
  titles: string[];
  industries: string[];
  company_sizes: string[];
  geographies: string[];
  exclusion_list: string[];
}

// ---------- Sending accounts ----------

export interface SendingAccount {
  id: string;
  account_label: string;
  linkedin_profile_url: string;
  status: string;
  health_score: number;
  daily_send_limit: number;
  sends_today: number;
  weekly_connection_limit: number;
  connections_this_week: number;
  sends_this_week?: number;
  created_at?: string;
}

// ---------- Inbox ----------

export type ConversationStatus = 'active' | 'hot_lead' | 'booked' | 'archived';

export interface Conversation {
  id: string;
  lead: Partial<Lead> & { name?: string };
  campaign_id: string;
  status: ConversationStatus;
  priority_score: number;
  last_message_at: string;
  last_message_preview: string;
}

export interface InboxMessage {
  id: string;
  sender_type: 'user' | 'prospect';
  content: string;
  sentiment_score: number | null;
  intent_class: string | null;
  created_at: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: InboxMessage[];
}

export interface InboxStats {
  active: number;
  hot_leads: number;
  needs_attention: number;
}

export type SuggestionApproach = 'direct' | 'value_add' | 'soft';

export interface ReplySuggestion {
  approach: SuggestionApproach;
  content: string;
}

// ---------- WebSocket ----------

export interface WsEvent<T = unknown> {
  event: string;
  data: T;
}

export interface WsNewReply {
  conversation_id: string;
  message: InboxMessage;
  lead_name: string;
  intent: string;
}

export interface WsHotLead {
  conversation_id: string;
  lead: Partial<Lead>;
  priority_score: number;
}

export interface WsDraftsReady {
  campaign_id: string;
  count: number;
}

export interface WsSafetyWarning {
  account_id: string;
  message: string;
  health_score: number;
}

// ---------- Knowledge base ----------

export interface KbDocument {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  upload_status: 'processing' | 'ready' | 'failed';
  vector_status: 'pending' | 'indexed' | 'failed';
  created_at: string;
}

export interface KbChatResponse {
  answer: string;
  sources: string[];
}

// ---------- Safety ----------

export interface SafetyAccount {
  id: string;
  account_label: string;
  linkedin_profile_url: string;
  status: string;
  health_score: number;
  daily_send_limit: number;
  sends_today: number;
  weekly_connection_limit: number;
  connections_this_week: number;
  sends_this_week: number;
}

export interface SafetyDashboard {
  accounts: SafetyAccount[];
  recommendations: string[];
}

export type RestrictionSeverity =
  | 'warning'
  | 'soft_limit'
  | 'hard_limit'
  | 'suspension';

export interface SafetyHistory {
  safety_logs: Array<Record<string, unknown>>;
  restriction_events: Array<Record<string, unknown>>;
}

// ---------- Analytics ----------

export interface AnalyticsTotals {
  messages_sent: number;
  replies_received: number;
  reply_rate: number;
  meetings_booked: number;
  drafts_generated: number;
  drafts_edited_pct: number;
}

export interface AnalyticsCampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  messages_sent: number;
  reply_rate: number;
  meetings_booked: number;
}

export interface TrendPoint {
  date: string;
  messages_sent: number;
  replies_received: number;
}

export interface AnalyticsDashboard {
  totals: AnalyticsTotals;
  campaigns: AnalyticsCampaignRow[];
  trend: TrendPoint[];
}

export interface HeatmapCell {
  hour_of_day: number;
  day_of_week: number;
  engagement_score: number;
  sample_size: number;
}

export interface HeatmapResponse {
  cells: HeatmapCell[];
}
